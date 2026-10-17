import type { Metadata } from "next";
import { GraphExplorer } from "@/components/graph/graph-explorer";

export const metadata: Metadata = { title: "Graph · Ripple" };

export default function GraphPage() {
  return <GraphExplorer />;
}
