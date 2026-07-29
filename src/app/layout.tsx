import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LionBan",
  description: "Seu centro de correções autônomas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
