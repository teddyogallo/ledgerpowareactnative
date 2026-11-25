import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

export function Page({ children, scroll = true, style }) {
  return <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
    {scroll
      ? <ScrollView contentContainerStyle={[styles.pageContent, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      : <View style={[styles.pageContent, style]}>{children}</View>}
  </SafeAreaView>;
}

export function Heading({ children, subtitle }) {
  return <View style={styles.heading}><Text style={styles.title}>{children}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>;
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline }) {
  return <View style={styles.fieldWrap}>{label ? <Text style={styles.label}>{label}</Text> : null}<TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textFaint} secureTextEntry={secureTextEntry} keyboardType={keyboardType} multiline={multiline} style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]} autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'} /></View>;
}

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false }) {
  return <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => [styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'danger' && styles.buttonDanger, (pressed || disabled || loading) && { opacity: 0.65 }]}><Text style={[styles.buttonText, variant !== 'primary' && styles.buttonSecondaryText]}>{loading ? 'Please wait…' : title}</Text></Pressable>;
}

export function Notice({ children, tone = 'info' }) {
  const bg = tone === 'error' ? '#FCE9E7' : tone === 'success' ? '#E5F3EB' : '#E8F0FA';
  const fg = tone === 'error' ? colors.negative : tone === 'success' ? colors.positive : colors.info;
  return <View style={[styles.notice, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 13, lineHeight: 19 }}>{children}</Text></View>;
}

export function Loading({ label = 'Loading…' }) {
  return <View style={styles.loading}><ActivityIndicator color={colors.accent}/><Text style={styles.subtitle}>{label}</Text></View>;
}

export function Empty({ children = 'No records found.' }) {
  return <Text style={styles.empty}>{children}</Text>;
}

export function stylesText() { return styles; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  pageContent: { padding: 18, paddingBottom: 36, gap: 14 },
  heading: { gap: 5, marginBottom: 4 },
  title: { fontSize: 27, color: colors.text, fontWeight: '600' },
  subtitle: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  fieldWrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 11, minHeight: 48, paddingHorizontal: 13, color: colors.text, fontSize: 15 },
  button: { minHeight: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.negative },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  buttonSecondaryText: { color: colors.accent },
  notice: { borderRadius: 10, padding: 12 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  empty: { color: colors.textFaint, fontSize: 13, paddingVertical: 12 }
});
