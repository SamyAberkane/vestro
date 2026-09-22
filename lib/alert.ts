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

// One entry per mounted AlertHost, in mount order. Only the LAST one renders:
// on iOS a React Native <Modal> presents from its own host's view controller,
// and one that is already presenting something (e.g. the paywall <Modal>)
// silently refuses to present a second — so an alert raised while a <Modal>
// is open, drawn by the root host, never appeared at all (the paywall's
// subscribe error looked like "the button does nothing" to App Review).
// Every <Modal> that can be open while alert() fires mounts its own
// AlertHost inside its content, which then takes over as the topmost host.
const hosts: Listener[] = [];
let currentState: AlertState | null = null;

function notify() {
  hosts.forEach((host, index) => host(index === hosts.length - 1 ? currentState : null));
}

export function subscribeToAlert(listener: Listener): () => void {
  hosts.push(listener);
  notify();
  return () => {
    const index = hosts.indexOf(listener);
    if (index !== -1) hosts.splice(index, 1);
    notify();
  };
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
