import { Suspense } from "react";
import { AskApp } from "@/components/ask/ask-app";

export default function Home() {
  return (
    <Suspense>
      <AskApp />
    </Suspense>
  );
}
