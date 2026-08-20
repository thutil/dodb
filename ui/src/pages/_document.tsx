import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="th" autoCapitalize="none">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body autoCapitalize="none" autoCorrect="off" spellCheck={false}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

