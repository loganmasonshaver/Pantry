import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

// True while the software keyboard is up.
//
// Use it to make close/discard controls keyboard-aware: when a keyboard is open, people tap the
// nearest ✕ / Cancel / backdrop just to get rid of it — so that first tap must dismiss the KEYBOARD,
// not throw away their work. A second tap (keyboard down) does the real action.
//
// Learned the hard way: the scan-review ✕ discarded 57 detected items from an already-paid vision
// call. Anywhere a TextInput shares a screen with a close/back/delete, guard it with this.
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    // iOS gets the `Will` events so the guard flips before the tap lands mid-animation.
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const s = Keyboard.addListener(showEvt, () => setVisible(true))
    const h = Keyboard.addListener(hideEvt, () => setVisible(false))
    return () => { s.remove(); h.remove() }
  }, [])
  return visible
}
