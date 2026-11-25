import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { supabase } from '../services/supabase';
import { Button, Field, Heading, Notice, Page } from '../components/UI';
import { colors } from '../theme/colors';

export default function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState('error');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setMessage('');
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (error) throw error;
        setTone('success'); setMessage('If this email is registered, a password reset email has been sent.');
      } else if (mode === 'signup') {
        if (password !== confirm) throw new Error('The passwords do not match.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setTone('success');
        setMessage(data.session ? 'Your account has been created.' : 'Account created. Check your email to confirm your address before signing in.');
        if (!data.session) setMode('signin');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) { setTone('error'); setMessage(e.message || 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Page style={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ marginBottom: 22, alignItems: 'center' }}><Image source={require('../../assets/ledger-sawa-mark.png')} resizeMode="contain" style={{ width: 104, height: 104, marginBottom: 12 }} /><Text style={{ color: colors.accent, letterSpacing: 2.5, fontSize: 15, fontWeight: '800' }}>LEDGER SAWA</Text><Text style={{ color: colors.textFaint, marginTop: 5 }}>Your money, clearly organised.</Text></View>
      <Heading>{mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset password'}</Heading>
      <Field label="EMAIL ADDRESS" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
      {mode !== 'reset' ? <Field label="PASSWORD" value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry/> : null}
      {mode === 'signup' ? <Field label="CONFIRM PASSWORD" value={confirm} onChangeText={setConfirm} placeholder="Enter password again" secureTextEntry/> : null}
      {message ? <Notice tone={tone}>{message}</Notice> : null}
      <Button title={mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} onPress={submit} loading={busy}/>
      <Button title={mode === 'signin' ? 'Create a new account' : 'Back to sign in'} variant="secondary" onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}/>
      {mode !== 'reset' ? <Button title="Forgot password?" variant="secondary" onPress={() => { setMode('reset'); setMessage(''); }}/> : null}
    </Page>
  </KeyboardAvoidingView>;
}
