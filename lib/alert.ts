export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: AlertButtonStyle;
};

export type AlertState = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type Listener = (state: AlertState | null) => void;

const listeners = new Set<Listener>();
let currentState: AlertState | null = null;

function notify() {
  listeners.forEach((listener) => listener(currentState));
}

export function subscribeToAlert(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop-in themed replacement for React Native's `Alert.alert` — same
 * signature (title, message, buttons), so every call site only had to swap
 * its import. Renders through AlertHost (mounted once in the root layout)
 * instead of the OS's own system-styled dialog, which otherwise broke out of
 * Vestro's look on every save/error/confirm across the whole app.
 */
export function alert(title: string, message?: string, buttons?: AlertButton[]): void {
  currentState = {
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
  };
  notify();
}

export function dismissAlert(): void {
  currentState = null;
  notify();
}
