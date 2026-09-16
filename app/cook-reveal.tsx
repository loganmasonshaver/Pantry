import { useRouter } from 'expo-router'
import { CookRevealView } from '@/components/CookRevealView'

// The reveal as a standalone route. The scan modal no longer navigates here — it renders
// CookRevealView as its own last step, so no screen can show between the scan and the payoff.
export default function CookReveal() {
  const router = useRouter()
  return (
    <CookRevealView
      onClose={() => router.back()}
      onOpenMeal={meal => router.push({ pathname: '/meal/[id]', params: { id: meal.id, mealData: JSON.stringify(meal) } })}
    />
  )
}
