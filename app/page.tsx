"use client";

import { useState } from "react";
import TopicReply from "./TopicReply";

export default function Page() {
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Engagement Console</h1>
          <div className="sub">
            Search live posts on a topic, then draft a comment only for the ones worth replying
            to. No auto-poster: you copy the comment and post it yourself.
          </div>
        </div>
      </header>

      <TopicReply onFlash={flash} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
