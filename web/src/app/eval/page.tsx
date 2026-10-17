import type { Metadata } from "next";
import { EvalReportView } from "@/components/eval/eval-report";

export const metadata: Metadata = { title: "Evaluation · Ripple" };

export default function EvalPage() {
  return <EvalReportView />;
}
