"use client";

/**
 * PROTOTYPE — ticket 05 (.scratch/hon-sma-v2/issues/05-row-layout-control-center.md).
 * Standalone view of the row + Control Center layout, fed hand-written mock
 * posts. Not linked from the live app; not the default results view.
 * View at /prototype-row while `npm run dev` is running.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import type { ScrapedPost } from "@/lib/types";
import { PostRow } from "../components/PostRow";

const MOCK_POSTS: ScrapedPost[] = [
  {
    platform: "reddit",
    external_id: "r1",
    url: "https://reddit.com/r/homegym/comments/abc123",
    author: "u/liftingdad42",
    title: "Finally caving and buying a rack — any recs under $600?",
    body:
      "Been putting this off for two years but my garage gym plan is happening. Space is tight, " +
      "about 6x6ft, and I mostly do squats/bench/deadlift. Looked at a few folding rack options " +
      "but reviews are mixed on stability once you load past 300lbs. Would rather spend a bit more " +
      "once than replace it in a year. Anyone actually used one of the mid-range foldable racks " +
      "long term? Also open to a good non-folding option if the footprint isn't crazy.",
    scraped_at: new Date().toISOString(),
    posted_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    source_query: "garage gym rack recommendations",
  },
  {
    platform: "facebook",
    external_id: "f1",
    url: "https://facebook.com/groups/localfitness/posts/998877",
    author: "Maria T.",
    title: undefined,
    body:
      "Does anyone know a good place (or person) that does small equipment repairs? My treadmill " +
      "belt keeps slipping and I don't want to just buy a new one if it's an easy fix. Based near " +
      "the north side, willing to drive a bit.",
    scraped_at: new Date().toISOString(),
    posted_at: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    source_query: "treadmill repair near me",
  },
  {
    platform: "hackernews",
    external_id: "hn1",
    url: "https://news.ycombinator.com/item?id=41234567",
    author: "throwaway9182",
    title: "Ask HN: How are you tracking workouts programmatically?",
    body:
      "I've tried three different apps and they all fall over once I want to do simple trend " +
      "analysis on volume over time (sets x reps x weight per muscle group per week). Considering " +
      "just building a small personal tool that reads from a spreadsheet. Has anyone found an " +
      "existing tool, paid or open source, that actually does useful analytics rather than just " +
      "logging?",
    scraped_at: new Date().toISOString(),
    posted_at: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    source_query: "workout tracking analytics",
  },
  {
    platform: "stackexchange",
    external_id: "se1",
    url: "https://fitness.stackexchange.com/questions/45678",
    author: "newlifter_22",
    title: "Best budget adjustable dumbbells that won't wobble mid-set?",
    body:
      "I keep seeing conflicting reviews on the cheaper adjustable dumbbell sets — some say the " +
      "locking mechanism gets loose after a few months of regular use. Budget is around $200-250 " +
      "for a pair. Mainly doing presses and rows, nothing above 50lbs per side for now but want " +
      "room to grow.",
    scraped_at: new Date().toISOString(),
    posted_at: new Date(Date.now() - 6 * 24 * 3_600_000).toISOString(),
    source_query: "budget adjustable dumbbells durability",
  },
];

export default function PrototypeRowPage() {
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-5 sm:px-8 py-10">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-[color:var(--muted)] glass rounded-full px-3 py-1.5 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-[color:var(--primary-2)]" />
          Prototype — ticket 05, not wired into the live app
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Row layout + Control Center</h1>
        <p className="text-sm text-[color:var(--muted)] max-w-2xl">
          Each result is a row. Left side is post info, scrollable for the full body. Right side is
          the Control Center: Open original, Save as link (stub, no persistence yet), and Generate
          comment (real — calls the existing /api/analyze-post).
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {MOCK_POSTS.map((post) => (
          <PostRow key={post.external_id} post={post} onToast={flash} />
        ))}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <span className="w-5 h-5 rounded-full grid place-items-center btn-primary">
              <Sparkles className="w-3 h-3" />
            </span>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
