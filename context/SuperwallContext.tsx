import { createContext, useContext, useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useSuperwall, useSuperwallEvents } from 'expo-superwall'

type SuperwallContextType = {
  isPremium: boolean
  loading: boolean
}

const SuperwallContext = createContext<SuperwallContextType>({
  isPremium: false,
  loading: true,
})

export function SuperwallContextProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false)
  const [loading, setLoading] = useState(true)
  const { subscriptionStatus } = useSuperwall()

  useEffect(() => {
    const status = subscriptionStatus?.status
    setIsPremium(status === 'ACTIVE')
    setLoading(false)
  }, [subscriptionStatus])

  useSuperwallEvents({
    onSubscriptionStatusChange: (status) => {
      setIsPremium(status?.status === 'ACTIVE')
    },
  })

  return (
    <SuperwallContext.Provider value={{ isPremium, loading }}>
      {children}
    </SuperwallContext.Provider>
  )
}

export const usePremium = () => useContext(SuperwallContext)
