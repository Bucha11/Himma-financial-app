import type { Metadata } from "next";
import "@/app/styles.css";

export const metadata: Metadata = {
  title: "Himma Finance Case",
  description: "Personal finance dashboard and AI spending assistant"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
