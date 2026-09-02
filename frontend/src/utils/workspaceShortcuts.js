import {
  Plug,
  Radio,
  Briefcase,
  BarChart3,
  Zap,
  Layers,
} from "lucide-react";

/** Shared with Dashboard and Landing so icons and colors stay in sync. */
export const WORKSPACE_SHORTCUTS = [
  {
    to: "/integrations",
    title: "Connect payments",
    blurb: "Connect Razorpay so failed payments can be recovered.",
    icon: Plug,
    tone: "bg-ink text-white",
  },
  {
    to: "/live-activity",
    title: "Live activity",
    blurb: "Watch recovery events as they happen.",
    icon: Radio,
    tone: "bg-pine-soft text-pine",
  },
  {
    to: "/operations",
    title: "Operations",
    blurb: "Review escalated, in-recovery, recovered, and stopped cases.",
    icon: Briefcase,
    tone: "bg-pine-soft text-pine",
  },
  {
    to: "/analytics",
    title: "Analytics",
    blurb: "KPIs, funnel, failure exposure, and verified recoveries.",
    icon: BarChart3,
    tone: "bg-skyline-soft text-skyline",
  },
  {
    to: "/event-console",
    title: "Create demo event",
    blurb: "Create a demo failed payment to start recovery.",
    icon: Zap,
    tone: "bg-sand-soft text-sand",
  },
  {
    to: "/batch-demo",
    title: "Batch demo",
    blurb: "Submit multiple simulated failures and measure recovery.",
    icon: Layers,
    tone: "bg-skyline-soft text-skyline",
  },
];
