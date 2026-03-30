import { useRef, useCallback } from 'react'
import { View } from 'react-native'
import { WebView } from 'react-native-webview'

const SITE_KEY = '0x4AAAAAACwdja-rhxwgnKlK'

const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoad" async defer></script>
  <script>
    function onLoad() {
      turnstile.render('#ct', {
        sitekey: '${SITE_KEY}',
        callback: function(token) {
          window.ReactNativeWebView.postMessage(token);
        },
        'error-callback': function() {
          window.ReactNativeWebView.postMessage('ERROR');
        },
      });
    }
  </script>
</head>
<body><div id="ct"></div></body>
</html>
`

type Props = {
  onToken: (token: string) => void
}

export default function TurnstileWebView({ onToken }: Props) {
  const webviewRef = useRef<WebView>(null)

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
    <View style={{ width: 0, height: 0, overflow: 'hidden' }}>
      <WebView
        ref={webviewRef}
        source={{ html, baseUrl: 'https://heypantry.app' }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={handleMessage}
      />
    </View>
  )
}
