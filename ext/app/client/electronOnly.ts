export function electronOnly() {
  if (window.electronAPI === undefined) {
    // User-facing error text, preventing a `window.electronAPI is undefined` error showing to users.
    // TODO - Find a better way to trigger the display of this.
    throw Error("Sorry, this must be done from within the app.");
  }
}
