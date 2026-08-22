import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="th" autoCapitalize="none">
      {/* Fonts are self-hosted in public/fonts and declared in styles/fonts.css — no external requests. */}
      <Head />
      <body autoCapitalize="none" autoCorrect="off" spellCheck={false}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
