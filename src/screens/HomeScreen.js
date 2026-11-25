import React, { useCallback, useEffect, useState } from 'react';
import { Image, Text, View, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { Button, Card, Empty, Field, Heading, Loading, Notice, Page } from '../components/UI';
import { colors } from '../theme/colors';

export default function HomeScreen({ session, navigation, onSignOut }) {
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState({ expenses: 0, income: 0 });
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const uid = session.user.id;
    const [memberships, expenses, income] = await Promise.all([
      supabase.from('household_members').select('households(*)').eq('user_id', uid),
      supabase.from('personal_expenses').select('amount').eq('user_id', uid),
      supabase.from('income').select('amount').eq('scope', 'personal').eq('user_id', uid)
    ]);
    if (memberships.error) setError(memberships.error.message);
    setHouseholds((memberships.data || []).map(x => x.households).filter(Boolean));
    setSummary({
      expenses: (expenses.data || []).reduce((s, x) => s + Number(x.amount || 0), 0),
      income: (income.data || []).reduce((s, x) => s + Number(x.amount || 0), 0)
    });
    setLoading(false);
  }, [session.user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function createHousehold() {
    if (!householdName.trim()) { setError('Enter a household name.'); return; }
    setWorking(true);
    const { error: err } = await supabase.rpc('create_household', { p_name: householdName.trim(), p_people: [] });
    if (err) setError(err.message); else { setHouseholdName(''); await load(); }
    setWorking(false);
  }

  async function joinHousehold() {
    if (!inviteCode.trim()) { setError('Enter an invitation code.'); return; }
    setWorking(true);
    const { error: err } = await supabase.rpc('join_household', { p_code: inviteCode.trim().toUpperCase() });
    if (err) setError(err.message); else { setInviteCode(''); await load(); }
    setWorking(false);
  }

  return <Page>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }}><Image source={require('../../assets/ledger-sawa-mark.png')} resizeMode="contain" style={{ width: 42, height: 42 }}/><View style={{ flex: 1 }}><Text style={{ color: colors.accent, fontSize: 18, fontWeight: '800', letterSpacing: 1.4 }}>LEDGER SAWA</Text><Text style={{ color: colors.textFaint, fontSize: 12 }}>Signed in as {session.user.email || 'your account'}</Text></View></View><Heading>Good day</Heading>
    {error ? <Notice tone="error">Couldn't load your dashboard: {error}</Notice> : null}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Personal income</Text><Text style={{ color: colors.positive, fontSize: 20, fontWeight: '700' }}>KES {summary.income.toLocaleString()}</Text></Card>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Personal expenses</Text><Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>KES {summary.expenses.toLocaleString()}</Text></Card>
    </View>
    <Heading subtitle="Choose where you want to work">Your ledgers</Heading>
    <Card><Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Personal finances</Text><Text style={{ color: colors.textDim }}>Track your private income, expenses and budgets.</Text><Button title="Open personal ledger" onPress={() => navigation.navigate('Personal')}/></Card>
    <Card><Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Households</Text>{loading ? <Loading/> : households.length ? households.map(h => <Pressable key={h.id} onPress={() => navigation.navigate('Household', { householdId: h.id })} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={{ fontWeight: '700', color: colors.accent }}>{h.name}</Text><Text style={{ color: colors.textFaint, fontSize: 12 }}>{h.currency || 'KES'} · Tap to open</Text></Pressable>) : <Empty>You are not a member of a household yet.</Empty>}</Card>
    <Card><Heading subtitle="Start a shared ledger or join an existing one">Household access</Heading><Field label="NEW HOUSEHOLD NAME" value={householdName} onChangeText={setHouseholdName} placeholder="e.g. Ogallo Family"/><Button title="Create household" onPress={createHousehold} loading={working}/><Field label="INVITATION CODE" value={inviteCode} onChangeText={setInviteCode} placeholder="Enter household code"/><Button title="Join household" variant="secondary" onPress={joinHousehold} loading={working}/></Card>
    <Button title="Refresh dashboard" variant="secondary" onPress={load}/>
    <Button title="Sign out" variant="secondary" onPress={onSignOut}/>
  </Page>;
}
