import { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Image, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { X, ChevronRight, Camera, Plus, Pencil, Clock, Instagram, Youtube } from 'lucide-react-native'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

export type MealToEdit = {
  id: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  prepTime?: number
  prep_time?: number
  ingredients: any[]
  steps: any[]
  image?: string | null
}

type Props = {
  visible: boolean
  onClose: () => void
  onSubmitted: () => void
  mealToEdit?: MealToEdit | null
}

type CreatorProfile = {
  id: string
  name: string
  handle: string
  instagram_url: string | null
  tiktok_url: string | null
  youtube_url: string | null
} | null

const DAILY_LIMIT = 2

function TikTokIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: size * 0.75, fontWeight: '900', lineHeight: size }}>♪</Text>
    </View>
  )
}

function toStringArray(items: any[]): string[] {
  return (items ?? []).map(i => (typeof i === 'string' ? i : (i.name ?? i.detail ?? '')))
}

// Splits a pasted multi-line list into clean rows: strips bullets, leading numbers,
// "Step N:" prefixes, and empty lines.
function parseList(text: string): string[] {
  return text.split(/\r?\n/)
    .map(l => l.trim()
      .replace(/^[-•*●▪‣–—]+\s*/, '')
      .replace(/^step\s*\d+\s*[:.)]?\s*/i, '')
      .replace(/^\d+\s*[.):\-]+\s*/, '')
      .trim()
    )
    .filter(Boolean)
}

export default function CreatorRecipeModal({ visible, onClose, onSubmitted, mealToEdit }: Props) {
  const { user } = useAuth()
  const isEditMode = !!mealToEdit
  const [step, setStep] = useState<'profile' | 'recipe'>('profile')
  const [creator, setCreator] = useState<CreatorProfile>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitLabel, setSubmitLabel] = useState(isEditMode ? 'Save Changes' : 'Post Recipe')
  const [todayCount, setTodayCount] = useState(0)

  // Profile fields
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [instagramHandle, setInstagramHandle] = useState('')
  const [tiktokHandle, setTiktokHandle] = useState('')
  const [youtubeHandle, setYoutubeHandle] = useState('')

  // Recipe fields — arrays for per-row editing
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [prepTime, setPrepTime] = useState('')
  const [ingredientsList, setIngredientsList] = useState<string[]>([''])
  const [stepsList, setStepsList] = useState<string[]>([''])
  const [ingredientsPaste, setIngredientsPaste] = useState('')
  const [stepsPaste, setStepsPaste] = useState('')
  // New recipes start in paste mode (one textarea per section). After Review,
  // we flip to row mode so creators can fix individual lines. Edits skip paste.
  const [pasteMode, setPasteMode] = useState(!isEditMode)
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null)

  // Pre-fill fields when in edit mode
  useEffect(() => {
    if (mealToEdit) {
      setName(mealToEdit.name ?? '')
      setCalories(String(mealToEdit.calories || ''))
      setProtein(String(mealToEdit.protein || ''))
      setCarbs(String(mealToEdit.carbs || ''))
      setFat(String(mealToEdit.fat || ''))
      setPrepTime(String(mealToEdit.prepTime ?? mealToEdit.prep_time ?? ''))
      setIngredientsList(toStringArray(mealToEdit.ingredients).length > 0 ? toStringArray(mealToEdit.ingredients) : [''])
      setStepsList(toStringArray(mealToEdit.steps).length > 0 ? toStringArray(mealToEdit.steps) : [''])
      setExistingImageUrl(mealToEdit.image ?? null)
    }
  }, [mealToEdit])

  useEffect(() => {
    if (!visible || !user) return
    setLoading(true)
    supabase
      .from('creators')
      .select('id, name, handle, instagram_url, tiktok_url, youtube_url')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (data) {
          setCreator(data)
          setStep('recipe')
          if (!isEditMode) {
            const today = new Date().toISOString().split('T')[0]
            const { count } = await supabase
              .from('trending_meals')
              .select('id', { count: 'exact', head: true })
              .eq('creator_id', data.id)
              .eq('generated_at', today)
            setTodayCount(count ?? 0)
          }
        } else {
          setStep(isEditMode ? 'recipe' : 'profile')
        }
        setLoading(false)
      })
  }, [visible, user?.id])

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access to add a recipe photo.'); return }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri)
      setExistingImageUrl(null)
    }
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access to take a photo.'); return }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    })
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri)
      setExistingImageUrl(null)
    }
  }

  const uploadPhoto = async (uri: string): Promise<string | null> => {
    try {
      // ArrayBuffer is more reliable than blob() in React Native
      const response = await fetch(uri)
      const arrayBuffer = await response.arrayBuffer()
      const filename = `creator-recipes/${Date.now()}.jpg`
      const { error } = await supabase.storage
        .from('meal-images')
        .upload(filename, arrayBuffer, { contentType: 'image/jpeg', upsert: true })
      if (error) {
        Alert.alert('Photo upload failed', error.message)
        return null
      }
      const { data } = supabase.storage.from('meal-images').getPublicUrl(filename)
      return data.publicUrl
    } catch (e: any) {
      Alert.alert('Photo upload failed', e?.message ?? 'Unknown error')
      return null
    }
  }

  const handleSaveProfile = async () => {
    if (!handle.trim() || !displayName.trim()) { Alert.alert('Required', 'Handle and name are required.'); return }
    const normalized = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!normalized) { Alert.alert('Invalid handle', 'Use only letters, numbers, and underscores.'); return }
    const igHandle = instagramHandle.trim().replace(/^@/, '').replace(/[^a-z0-9._]/gi, '')
    const ttHandle = tiktokHandle.trim().replace(/^@/, '').replace(/[^a-z0-9._]/gi, '')
    const ytHandle = youtubeHandle.trim().replace(/^@/, '').replace(/[^a-z0-9._-]/gi, '')
    setSubmitting(true)
    const { data, error } = await supabase
      .from('creators')
      .insert({
        name: displayName.trim(), handle: normalized, user_id: user!.id, is_active: true,
        instagram_url: igHandle ? `https://instagram.com/${igHandle}` : null,
        tiktok_url: ttHandle ? `https://tiktok.com/@${ttHandle}` : null,
        youtube_url: ytHandle ? `https://youtube.com/@${ytHandle}` : null,
      })
      .select('id, name, handle, instagram_url, tiktok_url, youtube_url')
      .single()
    setSubmitting(false)
    if (error) { Alert.alert('Error', error.message.includes('unique') ? 'That handle is already taken.' : error.message); return }
    setCreator(data)
    setTodayCount(0)
    setStep('recipe')
  }

  const handleSubmit = async () => {
    if (!name.trim()) { Alert.alert('Required', 'Recipe name is required.'); return }
    if (!isEditMode && !creator) return
    if (!isEditMode && todayCount >= DAILY_LIMIT) {
      Alert.alert('Daily limit reached', `You can post ${DAILY_LIMIT} recipes per day. Come back tomorrow!`)
      return
    }

    const ingredients = ingredientsList.map(l => l.trim()).filter(Boolean)
    // Strip leading numbers ("1.", "01)", "Step 1:") so they don't double up with the rendered step badge.
    const rawSteps = stepsList.map(l =>
      l.trim()
        .replace(/^step\s*\d+\s*[:.)]?\s*/i, '')
        .replace(/^\d+\s*[.):\-]+\s*/, '')
        .trim()
    ).filter(Boolean)

    setSubmitting(true)

    let cal = parseInt(calories) || 0
    let pro = parseInt(protein) || 0
    let carb = parseInt(carbs) || 0
    let fat_ = parseInt(fat) || 0
    let prep = parseInt(prepTime) || 0
    let stepTitles: string[] | null = null

    const macrosBlank = cal === 0 && pro === 0 && carb === 0 && fat_ === 0
    const prepBlank = prep === 0
    const needTitles = rawSteps.length > 0

    if ((macrosBlank || prepBlank || needTitles) && ingredients.length > 0) {
      setSubmitLabel('Estimating...')
      const recipeDesc = [
        name.trim(),
        `Ingredients: ${ingredients.join(', ')}`,
        rawSteps.length > 0 ? `Steps: ${rawSteps.join(' | ')}` : '',
      ].filter(Boolean).join('. ')

      // estimate-meal-macros uses GPT-4o + FatSecret cross-reference — much more accurate than
      // generate-recipe's gpt-4o-mini guess. generate-recipe (annotate mode) gives us prepTime
      // and short step titles in one call. Run them in parallel.
      const calls: Promise<any>[] = []
      if (macrosBlank) {
        calls.push(supabase.functions.invoke('estimate-meal-macros', {
          body: { mode: 'text', description: recipeDesc },
        }))
      }
      if (prepBlank || needTitles) {
        calls.push(supabase.functions.invoke('generate-recipe', {
          body: { description: recipeDesc, existingSteps: rawSteps },
        }))
      }
      const results = await Promise.all(calls)
      let idx = 0
      if (macrosBlank) {
        const m = results[idx++]?.data
        if (m && !m.error) {
          cal = Math.round(m.calories ?? 0)
          pro = Math.round(m.protein ?? 0)
          carb = Math.round(m.carbs ?? 0)
          fat_ = Math.round(m.fat ?? 0)
        }
      }
      if (prepBlank || needTitles) {
        const r = results[idx++]?.data
        if (r && !r.error) {
          if (prepBlank) prep = Math.round(r.prepTime ?? 0)
          if (needTitles && Array.isArray(r.titles) && r.titles.length === rawSteps.length) {
            stepTitles = r.titles.map((t: any) => String(t).trim())
          }
        }
      }
      setSubmitLabel(isEditMode ? 'Save Changes' : 'Post Recipe')
    }

    // Save steps as {title, detail} when we have AI-generated titles, matching the
    // format AI/scraped recipes use so the meal detail screen renders them identically.
    const steps: any[] = stepTitles
      ? rawSteps.map((detail, i) => ({ title: stepTitles![i], detail }))
      : rawSteps

    // Upload new photo if selected, keep existing if not changed
    let imageUrl: string | null = existingImageUrl ?? null
    if (photoUri) {
      imageUrl = await uploadPhoto(photoUri) ?? existingImageUrl ?? null
    }

    const payload = {
      name: name.trim(), calories: cal, protein: pro, carbs: carb, fat: fat_,
      prep_time: prep, ingredients, steps, image: imageUrl,
    }

    if (isEditMode && mealToEdit) {
      const { data: updated, error } = await supabase
        .from('trending_meals')
        .update(payload)
        .eq('id', mealToEdit.id)
        .select('id')
      setSubmitting(false)
      if (error) { Alert.alert('Save failed', error.message); return }
      if (!updated || updated.length === 0) {
        Alert.alert('Save failed', `No matching row found (id: ${mealToEdit.id ?? 'undefined'})`)
        return
      }
    } else {
      const { error } = await supabase.from('trending_meals').insert({
        ...payload,
        trend_source: 'creator',
        creator_id: creator!.id,
        generated_at: new Date().toISOString().split('T')[0],
        vote_score: 0,
      })
      setSubmitting(false)
      if (error) { Alert.alert('Error', error.message); return }
      setTodayCount(c => c + 1)
    }

    setName(''); setCalories(''); setProtein(''); setCarbs(''); setFat('')
    setPrepTime(''); setIngredientsList(['']); setStepsList(['']); setPhotoUri(null); setExistingImageUrl(null)
    setIngredientsPaste(''); setStepsPaste(''); setPasteMode(!isEditMode)
    onSubmitted()
  }

  const handleReview = () => {
    if (!name.trim()) { Alert.alert('Required', 'Recipe name is required.'); return }
    const ing = parseList(ingredientsPaste)
    const stp = parseList(stepsPaste)
    if (ing.length === 0) { Alert.alert('Add ingredients', 'Paste at least one ingredient, one per line.'); return }
    setIngredientsList(ing.length > 0 ? ing : [''])
    setStepsList(stp.length > 0 ? stp : [''])
    setPasteMode(false)
  }

  const updateIngredient = (i: number, val: string) => setIngredientsList(prev => prev.map((v, idx) => idx === i ? val : v))
  const removeIngredient = (i: number) => setIngredientsList(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [''])
  const addIngredient = () => setIngredientsList(prev => [...prev, ''])

  const updateStep = (i: number, val: string) => setStepsList(prev => prev.map((v, idx) => idx === i ? val : v))
  const removeStep = (i: number) => setStepsList(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [''])
  const addStep = () => setStepsList(prev => [...prev, ''])

  const displayImage = photoUri || existingImageUrl

  if (loading) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
        <View style={s.root}><ActivityIndicator color="#4ADE80" size="large" /></View>
      </Modal>
    )
  }

  const remaining = DAILY_LIMIT - todayCount
  const atLimit = !isEditMode && todayCount >= DAILY_LIMIT

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={s.root} edges={['top']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {step === 'profile' ? 'Creator Profile' : isEditMode ? 'Edit Recipe' : 'New Recipe'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><X size={22} color="#888" /></TouchableOpacity>
          </View>

          {step === 'profile' ? (
            /* ── Profile setup ── */
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              <Text style={s.subtitle}>Set up your creator profile once — it shows on every recipe you post.</Text>
              <Text style={s.label}>Display Name</Text>
              <TextInput style={s.input} placeholder="Jordan Shrinks" placeholderTextColor="#444" value={displayName} onChangeText={setDisplayName} autoCorrect={false} />
              <Text style={s.label}>Pantry Handle</Text>
              <Text style={s.hint}>Your @name shown on recipe cards in the app</Text>
              <View style={s.handleRow}>
                <Text style={s.at}>@</Text>
                <TextInput style={[s.input, { flex: 1 }]} placeholder="jordanshrinks" placeholderTextColor="#444" value={handle} onChangeText={t => setHandle(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))} autoCapitalize="none" autoCorrect={false} />
              </View>
              <Text style={[s.label, { marginTop: 28 }]}>Socials <Text style={{ color: '#555', fontWeight: '400', textTransform: 'none' }}>(optional)</Text></Text>
              <Text style={s.hint}>Let Pantry users find you — tap your handle on a recipe card to visit your profile</Text>
              {[
                { icon: <Instagram size={16} color="#E1306C" strokeWidth={2} />, bg: 'rgba(225,48,108,0.12)', val: instagramHandle, set: setInstagramHandle, ph: 'Instagram handle' },
                { icon: <TikTokIcon size={16} color="#fff" />, bg: 'rgba(255,255,255,0.06)', val: tiktokHandle, set: setTiktokHandle, ph: 'TikTok handle' },
                { icon: <Youtube size={16} color="#FF0000" strokeWidth={2} />, bg: 'rgba(255,0,0,0.1)', val: youtubeHandle, set: setYoutubeHandle, ph: 'YouTube handle' },
              ].map(({ icon, bg, val, set, ph }, i) => (
                <View key={i} style={s.socialRow}>
                  <View style={[s.socialIcon, { backgroundColor: bg }]}>{icon}</View>
                  <TextInput style={[s.input, { flex: 1 }]} placeholder={ph} placeholderTextColor="#444" value={val} onChangeText={t => set(t.replace(/^@/, ''))} autoCapitalize="none" autoCorrect={false} />
                </View>
              ))}
              <TouchableOpacity style={s.btn} onPress={handleSaveProfile} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#000" /> : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.btnText}>Continue</Text>
                    <ChevronRight size={18} color="#000" />
                  </View>
                )}
              </TouchableOpacity>
            </ScrollView>

          ) : (
            /* ── Recipe form — styled like meal card ── */
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

              {/* Hero photo area */}
              <TouchableOpacity style={s.hero} onPress={pickPhoto} activeOpacity={0.85}>
                {displayImage ? (
                  <>
                    <Image source={{ uri: displayImage }} style={s.heroImg} resizeMode="cover" />
                    <View style={s.heroEditBadge}>
                      <Pencil size={13} color="#fff" />
                      <Text style={s.heroEditText}>Change photo</Text>
                    </View>
                  </>
                ) : (
                  <View style={s.heroEmpty}>
                    <Camera size={36} color="#333" strokeWidth={1.5} />
                    <Text style={s.heroEmptyText}>Add cover photo</Text>
                    <TouchableOpacity style={s.heroCameraBtn} onPress={takePhoto}>
                      <Text style={s.heroCameraBtnText}>Camera</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>

              <View style={s.card}>
                {/* Status row */}
                {!isEditMode && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={s.postingAs}>Posting as <Text style={{ color: '#4ADE80' }}>@{creator?.handle}</Text></Text>
                    {atLimit
                      ? <Text style={{ fontSize: 12, color: '#EF4444' }}>Limit reached</Text>
                      : <Text style={{ fontSize: 12, color: '#555' }}>{remaining} left today</Text>
                    }
                  </View>
                )}

                {atLimit && (
                  <View style={s.limitBanner}>
                    <Text style={s.limitText}>You've posted {DAILY_LIMIT} recipes today. Come back tomorrow!</Text>
                  </View>
                )}

                {/* Editable title */}
                <TextInput
                  style={s.titleInput}
                  placeholder="Recipe name..."
                  placeholderTextColor="#333"
                  value={name}
                  onChangeText={setName}
                  editable={!atLimit}
                  multiline
                />

                {/* Prep time pill */}
                <View style={s.metaRow}>
                  <Clock size={13} stroke="#4ADE80" strokeWidth={2} />
                  <TextInput
                    style={s.prepInput}
                    placeholder="0"
                    placeholderTextColor="#444"
                    value={prepTime}
                    onChangeText={setPrepTime}
                    keyboardType="number-pad"
                    editable={!atLimit}
                  />
                  <Text style={s.metaText}>min</Text>
                  <Text style={s.metaHint}>· blank = AI estimates</Text>
                </View>

                {/* Macro bar */}
                <View style={s.macroBar}>
                  {[
                    { label: 'KCAL', value: calories, set: setCalories, color: '#4ADE80' },
                    { label: 'PROTEIN', value: protein, set: setProtein, color: '#fff' },
                    { label: 'CARBS', value: carbs, set: setCarbs, color: '#F59E0B' },
                    { label: 'FAT', value: fat, set: setFat, color: '#60A5FA' },
                  ].map(({ label, value, set, color }) => (
                    <View key={label} style={s.macroCell}>
                      <TextInput
                        style={[s.macroValue, { color }]}
                        placeholder="–"
                        placeholderTextColor="#333"
                        value={value}
                        onChangeText={set}
                        keyboardType="number-pad"
                        editable={!atLimit}
                      />
                      <Text style={s.macroLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.macroHint}>Leave all blank — AI estimates from ingredients</Text>

                {pasteMode ? (
                  <>
                    <Text style={s.sectionHeader}>INGREDIENTS</Text>
                    <TextInput
                      style={s.pasteArea}
                      placeholder={'Paste your ingredient list, one per line.\n\n1/2 avocado\n2 tbsp cocoa powder\n1 large egg'}
                      placeholderTextColor="#3A3A3A"
                      value={ingredientsPaste}
                      onChangeText={setIngredientsPaste}
                      multiline
                      textAlignVertical="top"
                      editable={!atLimit}
                    />
                    <Text style={s.pasteHint}>One per line. Bullets, numbers, and dashes get cleaned up.</Text>

                    <Text style={s.sectionHeader}>STEPS</Text>
                    <TextInput
                      style={s.pasteArea}
                      placeholder={'Paste your steps, one per line.\n\nBlend all ingredients.\nPour into ramekin and bake at 350F for 20 min.'}
                      placeholderTextColor="#3A3A3A"
                      value={stepsPaste}
                      onChangeText={setStepsPaste}
                      multiline
                      textAlignVertical="top"
                      editable={!atLimit}
                    />
                    <Text style={s.pasteHint}>One per line. "1." / "Step 1:" prefixes are stripped automatically.</Text>
                  </>
                ) : (
                  <>
                {/* Ingredients */}
                <Text style={s.sectionHeader}>INGREDIENTS</Text>
                {ingredientsList.map((ing, i) => (
                  <View key={i} style={s.ingRow}>
                    <View style={s.ingThumb} />
                    <TextInput
                      style={s.ingInput}
                      placeholder="e.g. 1/2 avocado"
                      placeholderTextColor="#444"
                      value={ing}
                      onChangeText={t => updateIngredient(i, t)}
                      editable={!atLimit}
                    />
                    <TouchableOpacity onPress={() => removeIngredient(i)} hitSlop={8}>
                      <X size={15} color="#444" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={s.addRow} onPress={addIngredient} disabled={atLimit}>
                  <Plus size={14} color="#4ADE80" />
                  <Text style={s.addText}>Add ingredient</Text>
                </TouchableOpacity>

                {/* Steps */}
                <Text style={s.sectionHeader}>STEPS</Text>
                {stepsList.map((step_, i) => (
                  <View key={i} style={s.stepRow}>
                    <Text style={s.stepNum}>{String(i + 1).padStart(2, '0')}</Text>
                    <TextInput
                      style={s.stepInput}
                      placeholder="Describe this step..."
                      placeholderTextColor="#444"
                      value={step_}
                      onChangeText={t => updateStep(i, t)}
                      multiline
                      textAlignVertical="top"
                      editable={!atLimit}
                    />
                    <TouchableOpacity onPress={() => removeStep(i)} hitSlop={8}>
                      <X size={15} color="#444" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={s.addRow} onPress={addStep} disabled={atLimit}>
                  <Plus size={14} color="#4ADE80" />
                  <Text style={s.addText}>Add step</Text>
                </TouchableOpacity>

                {/* Back-to-paste link, only when the user landed here from a paste */}
                {!isEditMode && (ingredientsPaste || stepsPaste) && (
                  <TouchableOpacity
                    onPress={() => setPasteMode(true)}
                    style={{ alignSelf: 'flex-start', marginTop: 8, marginBottom: 4 }}
                    hitSlop={8}
                  >
                    <Text style={{ color: '#888', fontSize: 13 }}>← Back to paste view</Text>
                  </TouchableOpacity>
                )}
                  </>
                )}

                {/* Submit */}
                <TouchableOpacity
                  style={[s.btn, atLimit && s.btnDisabled]}
                  onPress={pasteMode ? handleReview : handleSubmit}
                  disabled={submitting || atLimit}
                >
                  {submitting
                    ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <ActivityIndicator color="#000" size="small" />
                        <Text style={s.btnText}>{submitLabel}</Text>
                      </View>
                    : <Text style={[s.btnText, atLimit && { color: '#666' }]}>
                        {pasteMode ? 'Review →' : (isEditMode ? 'Save Changes' : 'Post Recipe')}
                      </Text>
                  }
                </TouchableOpacity>
              </View>

            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#111' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },

  // Profile step
  body: { padding: 20, paddingBottom: 60 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: '#888', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 12, color: '#555', marginBottom: 8, marginTop: -4 },
  input: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  at: { fontSize: 18, color: '#888', fontWeight: '600' },
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  socialIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: { width: '100%', height: 220, backgroundColor: '#0D0D0D', overflow: 'hidden' },
  heroImg: { width: '100%', height: '100%' },
  heroEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  heroEmptyText: { color: '#444', fontSize: 14, fontWeight: '500' },
  heroCameraBtn: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#1A1A1A', borderRadius: 20 },
  heroCameraBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
  heroEditBadge: { position: 'absolute', bottom: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  heroEditText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // Card container
  card: { padding: 20, paddingBottom: 48 },
  postingAs: { fontSize: 13, color: '#666' },
  limitBanner: { backgroundColor: '#1A0000', borderWidth: 1, borderColor: '#3A0000', borderRadius: 12, padding: 14, marginBottom: 16 },
  limitText: { color: '#EF4444', fontSize: 14 },

  // Title
  titleInput: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 14, minHeight: 36 },

  // Meta row
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  prepInput: { backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, color: '#fff', fontSize: 14, fontWeight: '600', minWidth: 44, textAlign: 'center' },
  metaText: { color: '#888', fontSize: 13 },
  metaHint: { color: '#333', fontSize: 12, marginLeft: 4 },

  // Macro bar — matches meal detail
  macroBar: { flexDirection: 'row', backgroundColor: '#111', borderRadius: 16, marginBottom: 6, overflow: 'hidden' },
  macroCell: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  macroValue: { fontSize: 20, fontWeight: '800' },
  macroLabel: { fontSize: 10, color: '#666', fontWeight: '600', marginTop: 3, letterSpacing: 0.4 },
  macroHint: { fontSize: 11, color: '#333', marginBottom: 24, textAlign: 'center' },

  // Ingredients
  sectionHeader: { fontSize: 12, fontWeight: '700', color: '#4ADE80', letterSpacing: 1.2, marginBottom: 12, marginTop: 8 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  ingThumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#111', borderWidth: 1, borderColor: '#1A1A1A' },
  ingInput: { flex: 1, backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#1A1A1A', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15 },

  // Steps
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  stepNum: { fontSize: 13, fontWeight: '700', color: '#333', width: 24, marginTop: 11, textAlign: 'right' },
  stepInput: { flex: 1, backgroundColor: '#0D0D0D', borderWidth: 1, borderColor: '#1A1A1A', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, minHeight: 44 },

  // Add row
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, marginBottom: 8 },
  addText: { color: '#4ADE80', fontSize: 14, fontWeight: '600' },

  // Paste textareas
  pasteArea: {
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    minHeight: 160,
    lineHeight: 22,
  },
  pasteHint: { color: '#555', fontSize: 12, marginTop: 6, marginBottom: 4 },

  // Button
  btn: { backgroundColor: '#fff', borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  btnDisabled: { backgroundColor: '#1A1A1A' },
  btnText: { color: '#000', fontSize: 16, fontWeight: '700' },
})
