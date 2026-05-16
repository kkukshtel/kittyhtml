// Resource fetcher used by the napi binding to populate `<img>` tags and any
// other network-loaded assets before layout.
//
// Adapted from himg/ext/himg/src/net_fetcher.rs (MIT-licensed by James
// Edwards-Jones). The structure is verbatim — a pending-request counter
// wrapped around blitz_net::Provider, plus an mpsc-backed callback that
// streams results back to a fetch loop. Trimmed of himg's logger plumbing.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_dom::net::Resource;
use blitz_html::HtmlDocument;
use blitz_net::Provider;
use blitz_traits::net::{BoxedHandler, NetCallback, NetProvider, Request};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

#[derive(Clone)]
struct PendingCount(Arc<AtomicUsize>);

impl PendingCount {
    fn new() -> Self {
        Self(Arc::new(AtomicUsize::new(0)))
    }
    fn increment(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn decrement(&self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
    fn is_empty(&self) -> bool {
        self.0.load(Ordering::SeqCst) == 0
    }
}

/// Callback that sends every fetched resource (or error) into an mpsc
/// channel, so the fetch loop can drive document.load_resource on the main
/// thread.
struct ChannelCallback<T>(UnboundedSender<(usize, Result<T, Option<String>>)>);

impl<T: Send + Sync + 'static> NetCallback<T> for ChannelCallback<T> {
    fn call(&self, doc_id: usize, result: Result<T, Option<String>>) {
        let _ = self.0.send((doc_id, result));
    }
}

/// Counting wrapper around blitz_net::Provider. Tracks in-flight requests so
/// we know when fetching has settled.
struct CountingProvider<D> {
    inner: Arc<Provider<D>>,
    callback: Arc<dyn NetCallback<D>>,
    pending: PendingCount,
}

impl<D: Send + Sync + 'static> CountingProvider<D> {
    fn new(callback: Arc<dyn NetCallback<D>>) -> Self {
        let inner = Arc::new(Provider::new(callback.clone()));
        Self {
            inner,
            callback,
            pending: PendingCount::new(),
        }
    }
    fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

impl<D: Send + Sync + 'static> NetProvider<D> for CountingProvider<D> {
    fn fetch(&self, doc_id: usize, request: Request, handler: BoxedHandler<D>) {
        self.pending.increment();
        let callback = self.callback.clone();
        let pending = self.pending.clone();
        self.inner.fetch_with_callback(
            request,
            Box::new(move |fetch_result| {
                match fetch_result {
                    Ok((_url, bytes)) => handler.bytes(doc_id, bytes, callback),
                    Err(e) => callback.call(doc_id, Err(Some(format!("fetch error: {e:?}")))),
                }
                pending.decrement();
            }),
        );
    }
}

/// Public API. Create one per render, hand `provider()` to DocumentConfig,
/// then `await fetch_resources(&mut doc)` after the initial parse to drain
/// every `<img>` / `@import` / external font reference.
pub struct NetFetcher {
    provider: Arc<CountingProvider<Resource>>,
    receiver: UnboundedReceiver<(usize, Result<Resource, Option<String>>)>,
}

impl NetFetcher {
    pub fn new() -> Self {
        let (sender, receiver) = unbounded_channel();
        let callback: Arc<dyn NetCallback<Resource>> = Arc::new(ChannelCallback(sender));
        let provider = Arc::new(CountingProvider::new(callback));
        Self { provider, receiver }
    }

    pub fn provider(&self) -> Arc<dyn NetProvider<Resource>> {
        Arc::clone(&self.provider) as Arc<dyn NetProvider<Resource>>
    }

    pub async fn fetch_resources(&mut self, document: &mut HtmlDocument) {
        loop {
            // try_recv first so a fetch that fails before await has a chance
            // to drain before is_empty() short-circuits (himg's same dance).
            let res = match self.receiver.try_recv() {
                Ok((_, res)) => res,
                Err(_) => {
                    if self.provider.is_empty() {
                        break;
                    }
                    match self.receiver.recv().await {
                        Some((_, res)) => res,
                        None => break,
                    }
                }
            };
            if let Ok(res) = res {
                document.as_mut().load_resource(res);
            }
        }
    }
}
