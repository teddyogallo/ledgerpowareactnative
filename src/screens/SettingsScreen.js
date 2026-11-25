import React, { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { Card, Empty, Heading, Loading, Notice, Page } from '../components/UI';
import { colors } from '../theme/colors';

export default function SettingsScreen({ session }) {
  const [personalCategories, setPersonalCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    const uid = session.user.id;
    const [p, i] = await Promise.all([
      supabase.from('personal_categories').select('*').eq('user_id', uid).order('sort_order'),
      supabase.from('income_categories').select('*').eq('scope', 'personal').eq('user_id', uid).order('sort_order')
    ]);
    if (p.error || i.error) setError(p.error?.message || i.error?.message);
    setPersonalCategories(p.data || []); setIncomeCategories(i.data || []); setLoading(false);
  }, [session.user.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (loading) return <Page><Loading label="Loading settings…"/></Page>;
  return <Page>
    <Heading subtitle={session.user.email}>Settings</Heading>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <Card><Heading>Personal expense categories</Heading>{personalCategories.length ? personalCategories.map(c => <Text key={c.id} style={{ color: colors.text, paddingVertical: 7 }}>{c.name}{c.archived ? ' · Archived' : ''}</Text>) : <Empty/>}</Card>
    <Card><Heading>Income categories</Heading>{incomeCategories.length ? incomeCategories.map(c => <Text key={c.id} style={{ color: colors.text, paddingVertical: 7 }}>{c.name}{c.archived ? ' · Archived' : ''}</Text>) : <Empty/>}</Card>
    <Card><Heading>Account</Heading><Text style={{ color: colors.textDim }}>Signed in as {session.user.email}</Text><Text style={{ color: colors.textFaint, fontSize: 12 }}>Ledger Sawa mobile app · v1.0.0</Text></Card>
  </Page>;
}
