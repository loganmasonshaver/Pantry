import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'

const SITE_KEY = '0x4AAAAAACwdja-rhxwgnKlK'

const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoad" async defer></script>
  <script>
    var widgetId;
    function onLoad() {
      widgetId = turnstile.render('#ct', {
        sitekey: '${SITE_KEY}',
        callback: function(token) {
          window.ReactNativeWebView.postMessage(token);
        },
        'error-callback': function() {
          window.ReactNativeWebView.postMessage('ERROR');
        },
      });
    }
    function resetWidget() {
      if (widgetId !== undefined) {
        turnstile.reset(widgetId);
      }
    }
  </script>
</head>
<body><div id="ct"></div></body>
</html>
`

export type TurnstileRef = {
  reset: () => void
}

type Props = {
  onToken: (token: string) => void
}

export default forwardRef<TurnstileRef, Props>(function TurnstileWebView({ onToken }, ref) {
  const webviewRef = useRef<WebView>(null)

  useImperativeHandle(ref, () => ({
    reset: () => {
      webviewRef.current?.injectJavaScript('resetWidget(); true;') // WebView requires injected JS to evaluate to a truthy value
    },
  }))

  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      const token = event.nativeEvent.data
      if (token && token !== 'ERROR') {
        onToken(token)
      }
    },
    [onToken],
  )

  return (
    // 0×0 hidden view — only exists to run the Turnstile challenge, never shown to the user
    <View style={{ width: 0, height: 0, overflow: 'hidden' }}>
      <WebView
        ref={webviewRef}
        source={{ html, baseUrl: 'https://heypantry.app' }} // Cloudflare validates the request origin against this domain
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={handleMessage}
      />
    </View>
  )
})
