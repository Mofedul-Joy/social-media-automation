/**
 * Shown while the page's one read of the counts store is in flight. Deliberately
 * blank shapes and no digits: a spinner in the middle of the content is worse,
 * and a placeholder number would be a fabricated figure for as long as it is on
 * screen, which this page never does.
 */
export default function Loading() {
  return (
    <main className="relative z-10 mx-auto max-w-5xl px-5 sm:px-8 py-10" aria-busy="true">
      <div className="h-9 w-40 rounded-xl skeleton mb-10" />
      <div className="h-10 w-72 rounded-xl skeleton mb-4" />
      <div className="h-5 w-full max-w-2xl rounded-lg skeleton mb-9" />

      <div className="glass rounded-2xl p-6 sm:p-8 mb-12">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-7">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i}>
              <div className="h-4 w-24 rounded skeleton mb-3" />
              <div className="h-9 w-16 rounded-lg skeleton" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl h-56 skeleton" />
        <div className="glass rounded-2xl h-56 skeleton" />
      </div>
    </main>
  );
}
