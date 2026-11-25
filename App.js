import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase, configError } from './src/services/supabase';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import HouseholdScreen from './src/screens/HouseholdScreen';
import PersonalScreen from './src/screens/PersonalScreen';
import IncomeScreen from './src/screens/IncomeScreen';
import DebtsScreen from './src/screens/DebtsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ReportsScreen from './src/screens/ReportsScreen';
import BillsScreen from './src/screens/BillsScreen';
import { flushQueue } from './src/services/offlineQueue';
import { colors } from './src/theme/colors';

const Tab = createBottomTabNavigator();

function MainTabs({ session, onSignOut }) {
  return <Tab.Navigator screenOptions={({ route }) => ({
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleStyle: { fontWeight: '700' },
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingBottom: 7, paddingTop: 5 },
    tabBarActiveTintColor: colors.accent,
    tabBarInactiveTintColor: colors.textFaint,
    tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
    tabBarIcon: ({ color, size, focused }) => { const icons = { Home: focused ? 'home' : 'home-outline', Household: focused ? 'people' : 'people-outline', Personal: focused ? 'wallet' : 'wallet-outline', Income: focused ? 'trending-up' : 'trending-up-outline', Reports: focused ? 'bar-chart' : 'bar-chart-outline', Bills: focused ? 'calendar' : 'calendar-outline', Debts: focused ? 'swap-horizontal' : 'swap-horizontal-outline', Setup: focused ? 'settings' : 'settings-outline' }; return <Ionicons name={icons[route.name] || 'ellipse-outline'} size={size} color={color}/>; }
  })}>
    <Tab.Screen name="Home" options={{ title: 'Ledger Sawa' }}>{props => <HomeScreen {...props} session={session} onSignOut={onSignOut}/>}</Tab.Screen>
    <Tab.Screen name="Household" component={HouseholdScreen} options={{ title: 'Household' }}/>
    <Tab.Screen name="Personal" options={{ title: 'Personal' }}>{props => <PersonalScreen {...props} session={session}/>}</Tab.Screen>
    <Tab.Screen name="Income" options={{ title: 'Income' }}>{props => <IncomeScreen {...props} session={session}/>}</Tab.Screen>
    <Tab.Screen name="Bills" options={{ title: 'Bills' }}>{props => <BillsScreen {...props} session={session}/>}</Tab.Screen>
    <Tab.Screen name="Reports" options={{ title: 'Reports' }}>{props => <ReportsScreen {...props} session={session}/>}</Tab.Screen>
    <Tab.Screen name="Debts" options={{ title: 'Debts' }}>{props => <DebtsScreen {...props} session={session}/>}</Tab.Screen>
    <Tab.Screen name="Setup" options={{ title: 'Settings' }}>{props => <SettingsScreen {...props} session={session}/>}</Tab.Screen>
  </Tab.Navigator>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (configError) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    const net = NetInfo.addEventListener(state => { if (state.isConnected) flushQueue().catch(() => {}); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') flushQueue().catch(() => {}); });
    const retry = setInterval(() => flushQueue().catch(() => {}), 30000);
    return () => { listener.subscription.unsubscribe(); net(); app.remove(); clearInterval(retry); };
  }, []);

  async function signOut() { await supabase.auth.signOut(); }

  let content;
  if (configError) {
    content = <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}><Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: 10 }}>Ledger Sawa setup required</Text><Text style={{ color: colors.textDim, lineHeight: 22 }}>{configError}</Text></View>;
  } else if (loading) {
    content = <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.accent}/><Text style={{ color: colors.textDim, marginTop: 12 }}>Loading Ledger Sawa…</Text></View>;
  } else if (!session) {
    content = <AuthScreen/>;
  } else {
    content = <NavigationContainer><MainTabs session={session} onSignOut={signOut}/></NavigationContainer>;
  }

  return <SafeAreaProvider><StatusBar style="dark" backgroundColor={colors.bg}/>{content}</SafeAreaProvider>;
}
