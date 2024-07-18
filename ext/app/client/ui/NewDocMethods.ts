export async function createDocAndOpen() {
  // Only available for the electron user. Network visitors would get an error.
  const doc = await window.electronAPI.createDocAndOpen();
  if (doc) {
    window.location.assign("/o/docs/" + doc.id);
  }
}

export async function importDocAndOpen() {
  alert("not implemented");
}

export async function importFromPluginAndOpen() {
  alert("not implemented");
}
