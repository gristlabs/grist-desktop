export function electronOnly() {
  if (window.electronAPI === undefined) {
    throw Error("Sorry, this must be done from within the app.");
  }
}
