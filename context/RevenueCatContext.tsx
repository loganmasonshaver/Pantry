import { createContext, useContext, useEffect, useState } from 'react'
import { Alert, Platform } from 'react-native'
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
  LOG_LEVEL,
} from 'react-native-purchases'

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY!

type RevenueCatContextType = {
  isPremium: boolean
  packages: PurchasesPackage[]
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>
  restorePurchases: () => Promise<boolean>
  loading: boolean
}

const RevenueCatContext = createContext<RevenueCatContextType>({
  isPremium: false,
  packages: [],
  purchasePackage: async () => false,
  restorePurchases: async () => false,
  loading: true,
})

export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  const [isPremium, setIsPremium] = useState(false)
  const [packages, setPackages] = useState<PurchasesPackage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (Platform.OS === 'ios') {
      Purchases.setLogLevel(LOG_LEVEL.ERROR)
      Purchases.configure({ apiKey: API_KEY })
    }

    const init = async () => {
      try {
        const customerInfo = await Purchases.getCustomerInfo()
        setIsPremium(!!customerInfo.entitlements.active['premium'])

        const offerings = await Purchases.getOfferings()
        if (offerings.current?.availablePackages.length) {
          setPackages(offerings.current.availablePackages)
        }
      } catch (e) {
        // SDK not ready (e.g. simulator without StoreKit) — stay on free
      } finally {
        setLoading(false)
      }
    }

    init()

    const listener = Purchases.addCustomerInfoUpdateListener((info: CustomerInfo) => {
      setIsPremium(!!info.entitlements.active['premium'])
    })

    return () => listener.remove()
  }, [])

  const purchasePackage = async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg)
      const premium = !!customerInfo.entitlements.active['premium']
      setIsPremium(premium)
      return premium
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert('Purchase failed', e.message)
      }
      return false
    }
  }

  const restorePurchases = async (): Promise<boolean> => {
    try {
      const customerInfo = await Purchases.restorePurchases()
      const premium = !!customerInfo.entitlements.active['premium']
      setIsPremium(premium)
      if (premium) {
        Alert.alert('Restored', 'Your premium subscription has been restored.')
      } else {
        Alert.alert('No subscription found', 'No active subscription was found to restore.')
      }
      return premium
    } catch (e: any) {
      Alert.alert('Restore failed', e.message)
      return false
    }
  }

  return (
    <RevenueCatContext.Provider value={{ isPremium, packages, purchasePackage, restorePurchases, loading }}>
      {children}
    </RevenueCatContext.Provider>
  )
}

export const useRevenueCat = () => useContext(RevenueCatContext)
