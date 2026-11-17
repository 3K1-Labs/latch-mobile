import * as WebBrowser from 'expo-web-browser';

/** Opens a URL in the in-app browser sheet rather than leaving for Safari/Chrome. */
export function openInAppBrowser(url: string): void {
  WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  }).catch(() => {});
}
