export function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

export function NoWebGL() {
  return (
    <main
      role="alert"
      style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24,
        background: '#05060d', color: '#c9cde0', textAlign: 'center',
        font: '16px/1.5 system-ui, sans-serif',
      }}
    >
      <p>This map needs a newer browser. Please update your browser or try another one.</p>
    </main>
  );
}
