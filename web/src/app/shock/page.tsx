import type { Metadata } from "next";
import { ShockSimulator } from "@/components/shock/shock-simulator";

export const metadata: Metadata = { title: "Shock · Ripple" };

export default function ShockPage() {
  return <ShockSimulator />;
}
