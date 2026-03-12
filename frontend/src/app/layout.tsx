import type { Metadata } from "next";
import "./globals.css";
import Navigation from "@/components/Navigation";
import Providers from "@/components/Providers";

export const metadata: Metadata = {
  title: "AI Agent",
  description: "AI Agent - Document Intelligence",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full flex flex-col antialiased">
        <Providers>
          <Navigation />
          <main className="flex-1 overflow-auto w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
