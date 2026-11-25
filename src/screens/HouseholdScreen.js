import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { Button, Card, Empty, Field, Heading, Loading, Notice, Page } from '../components/UI';
import { colors } from '../theme/colors';
import { monthKey, monthLabel, nowDT, localToISO, parseAmount, computeBudget, computeMonthlyTotal, monthlyTotals } from '../services/ledgerLogic';
import { exportCSV, exportPDF } from '../services/exports';
import { enqueue, flushQueue, pendingCount } from '../services/offlineQueue';
import NetInfo from '@react-native-community/netinfo';

const money = (n, currency = 'KES') => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function HouseholdScreen({ route }) {
  const requestedHouseholdId = route.params?.householdId;
  const [householdId, setHouseholdId] = useState(requestedHouseholdId || null);
  useEffect(() => { if (requestedHouseholdId) setHouseholdId(requestedHouseholdId); }, [requestedHouseholdId]);
  const [household, setHousehold] = useState(null);
  const [categories, setCategories] = useState([]);
  const [people, setPeople] = useState([]);
  const [terms, setTerms] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [expenseReference, setExpenseReference] = useState('');
  const [expenseDate, setExpenseDate] = useState(nowDT());
  const [showSetup, setShowSetup] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState('none');
  const [budgetRollover, setBudgetRollover] = useState(true);
  const [excludeFromTotal, setExcludeFromTotal] = useState(false);
  const [quickLabel, setQuickLabel] = useState('');
  const [quickAmount, setQuickAmount] = useState('');
  const [quickCategory, setQuickCategory] = useState('');
  const [quickPeople, setQuickPeople] = useState('');
  const [quickDueDay, setQuickDueDay] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [peopleNames, setPeopleNames] = useState('');
  const [termName, setTermName] = useState('');
  const [termMonths, setTermMonths] = useState('1,2,3,4');
  const [viewMonth, setViewMonth] = useState(monthKey(new Date()));
  const [pending, setPending] = useState(0);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [monthlyCap, setMonthlyCap] = useState('');
  const [obligationTitle, setObligationTitle] = useState('');
  const [obligationAmount, setObligationAmount] = useState('');
  const [paymentFor, setPaymentFor] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    let activeId = requestedHouseholdId || householdId;
    if (!activeId) {
      const { data: authData } = await supabase.auth.getUser();
      const { data: memberships, error: memberError } = await supabase.from('household_members').select('household_id').eq('user_id', authData.user?.id).limit(1);
      if (memberError) { setError(memberError.message); setBusy(false); return; }
      activeId = memberships?.[0]?.household_id || null;
      if (activeId) setHouseholdId(activeId);
    }
    if (!activeId) { setError('You are not a member of a household yet. Create or join one from Home.'); setBusy(false); return; }
    const [h, c, p, t, e, o, tm, a] = await Promise.all([
      supabase.from('households').select('*').eq('id', activeId).single(),
      supabase.from('categories').select('*').eq('household_id', activeId).order('sort_order'),
      supabase.from('people').select('*').eq('household_id', activeId).order('name'),
      supabase.from('terms').select('*').eq('household_id', activeId).order('sort_order'),
      supabase.from('expenses').select('*').eq('household_id', activeId).order('date', { ascending: false }).limit(1000),
      supabase.from('obligations').select('*').eq('household_id', activeId).order('created_at', { ascending: false }),
      supabase.from('templates').select('*').eq('household_id', activeId).order('created_at'),
      supabase.from('audit_log').select('*').eq('household_id', activeId).order('created_at', { ascending: false }).limit(100)
    ]);
    if (h.error) setError(h.error.message);
    else { setHousehold(h.data); setMonthlyCap(h.data?.monthly_budget == null ? '' : String(h.data.monthly_budget)); }
    setCategories(c.data || []); setPeople(p.data || []); setTerms(t.data || []);
    setExpenses(e.data || []); setObligations(o.data || []); setTemplates(tm.data || []); setAudit(a.data || []);
    setBusy(false);
  }, [householdId, requestedHouseholdId]);

  useFocusEffect(useCallback(() => { load(); pendingCount().then(setPending); }, [load]));
  useEffect(() => { const unsub = NetInfo.addEventListener(state => { if (state.isConnected) flushQueue().then(r => { setPending(r.pending || 0); if (r.synced) load(); }).catch(() => {}); }); return () => unsub(); }, [load]);

  async function recordAudit(action, entity, summary) {
    try { const user=(await supabase.auth.getUser()).data.user; if(user) await supabase.from('audit_log').insert({household_id:householdId,user_id:user.id,user_email:user.email,action,entity,summary}); } catch (_) { /* audit logging must not block ledger writes */ }
  }
  async function saveExpense() {
    const parsed = parseAmount(amount);
    if (parsed === null) { setError('Enter an amount using plain digits, e.g. 12000 or 12000.50.'); return; }
    const user = (await supabase.auth.getUser()).data.user;
    const payload = { household_id: householdId || requestedHouseholdId, amount: parsed, category: category || categories[0]?.name || 'Other', recipient, note, reference: expenseReference.trim(), date: localToISO(expenseDate), paid_by_user_id: user?.id, paid_by_label: user?.email || '', created_by: user?.id, ...(editingExpenseId ? {updated_by:user?.id,updated_at:new Date().toISOString()} : {}) };
    const net = await NetInfo.fetch();
    if (!net.isConnected && !editingExpenseId) {
      const count = await enqueue({ table: 'expenses', payload });
      setPending(count); setAmount(''); setRecipient(''); setNote(''); setExpenseReference(''); setExpenseDate(nowDT()); setShowExpenseForm(false);
      setError('Saved on this device. It will sync automatically when you reconnect.'); return;
    }
    const { error: err } = editingExpenseId ? await supabase.from('expenses').update({...payload, updated_at:new Date().toISOString()}).eq('id', editingExpenseId) : await supabase.from('expenses').insert(payload);
    if (err) setError(err.message);
    else { await recordAudit(editingExpenseId?'edited':'created','expense',`${money(parsed,household?.currency)} · ${payload.category}`); setAmount(''); setRecipient(''); setNote(''); setExpenseReference(''); setExpenseDate(nowDT()); setShowExpenseForm(false); setEditingExpenseId(null); load(); }
  }

  function editExpense(entry) {
    setEditingExpenseId(entry.id); setAmount(String(entry.amount)); setCategory(entry.category || '');
    setRecipient(entry.recipient || ''); setNote(entry.note || ''); setExpenseReference(entry.reference || ''); setExpenseDate(entry.date || nowDT()); setShowExpenseForm(true);
  }
  function deleteExpense(entry) {
    Alert.alert('Delete household expense?', `Delete ${money(entry.amount, household?.currency)} · ${entry.category}? This cannot be undone.`, [{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const{error}=await supabase.from('expenses').delete().eq('id',entry.id);if(error)setError(error.message);else load();}}]);
  }

  async function saveCategory() {
    if (!newCategory.trim()) return setError('Enter an expense type name.');
    const amountValue = budgetAmount.trim() ? Number(budgetAmount) : null;
    if (amountValue !== null && (!Number.isFinite(amountValue) || amountValue < 0)) return setError('Enter a valid budget amount.');
    const payload = { household_id: householdId, name: newCategory.trim(), budget_amount: amountValue, budget_period: budgetPeriod === 'none' ? null : budgetPeriod, sort_order: categories.length + 1, budget_rollover: budgetRollover, exclude_from_total: excludeFromTotal };
    const { error: err } = editingCategoryId ? await supabase.from('categories').update(payload).eq('id', editingCategoryId) : await supabase.from('categories').insert(payload);
    if (err) setError(err.message); else { await recordAudit(editingCategoryId?'edited':'created','category',payload.name); setNewCategory(''); setBudgetAmount(''); setBudgetPeriod('none'); setBudgetRollover(true); setExcludeFromTotal(false); setEditingCategoryId(null); setShowSetup(''); await load(); }
  }

  async function saveMonthlyCap() {
    const value = monthlyCap.trim() ? parseAmount(monthlyCap) : null;
    if (monthlyCap.trim() && value === null) return setError('Enter a valid monthly cap or leave blank.');
    const { error } = await supabase.from('households').update({ monthly_budget: value }).eq('id', householdId);
    if (error) setError(error.message); else { await recordAudit('updated','household','Monthly cap updated'); load(); }
  }
  async function createObligation() {
    const value = parseAmount(obligationAmount);
    if (!obligationTitle.trim() || value === null) return setError('Enter an obligation title and valid amount.');
    const { error } = await supabase.from('obligations').insert({ household_id: householdId, title: obligationTitle.trim(), category: categories[0]?.name || 'Other', total_amount: value });
    if (error) setError(error.message); else { await recordAudit('created','obligation',`${obligationTitle.trim()} · ${money(value,household?.currency)}`); setObligationTitle(''); setObligationAmount(''); await load(); }
  }
  async function saveObligationPayment() {
    const value = parseAmount(paymentAmount); if (!paymentFor || value === null) return setError('Enter a valid payment amount.');
    const paid = expenses.filter(e => e.obligation_id === paymentFor.id).reduce((sum,e)=>sum+Number(e.amount||0),0);
    if (value > Number(paymentFor.total_amount)-paid+0.0001) return setError('Payment exceeds the remaining obligation balance.');
    const { error } = await supabase.from('expenses').insert({ household_id: householdId, obligation_id: paymentFor.id, amount: value, category: paymentFor.category || 'Other', recipient: '', note: `Payment toward ${paymentFor.title}`, reference: paymentReference.trim(), date: new Date().toISOString(), paid_by_user_id: (await supabase.auth.getUser()).data.user?.id });
    if (error) setError(error.message); else { await recordAudit('created','expense',`Payment toward ${paymentFor.title} · ${money(value,household?.currency)}`); setPaymentFor(null); setPaymentAmount(''); setPaymentReference(''); await load(); }
  }
  function deleteObligation(o) { Alert.alert('Delete obligation?', `Delete ${o.title}? Payment history may be affected.`, [{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const{error}=await supabase.from('obligations').delete().eq('id',o.id);if(error)setError(error.message);else load();}}]); }
  function deleteSetupRow(table,row,label) { Alert.alert(`Delete ${label}?`,`Remove ${label}?`,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const{error}=await supabase.from(table).delete().eq('id',row.id);if(error)setError(error.message);else load();}}]); }
  async function saveQuickEntry() {
    const value = Number(quickAmount);
    if (!quickLabel.trim() || !Number.isFinite(value) || value <= 0) return setError('Enter a quick-entry label and a valid amount.');
    const cat = quickCategory || categories[0]?.name || 'Other';
    const recipients = quickPeople.split(',').map(x => x.trim()).filter(Boolean).join(', ');
    const payload = { household_id: householdId, label: quickLabel.trim(), amount: value, category: cat, recipient: recipients, due_day: quickDueDay.trim() ? Number(quickDueDay) : null };
    if (quickDueDay.trim() && (!Number.isInteger(Number(quickDueDay)) || Number(quickDueDay)<1 || Number(quickDueDay)>31)) return setError('Due day must be between 1 and 31.');
    const { error: err } = editingTemplateId ? await supabase.from('templates').update(payload).eq('id',editingTemplateId) : await supabase.from('templates').insert(payload);
    if (err) setError(err.message); else { setQuickLabel(''); setQuickAmount(''); setQuickPeople(''); setQuickDueDay(''); setEditingTemplateId(null); setShowSetup(''); await load(); }
  }

  async function savePeople() {
    const names = [...new Set(peopleNames.split(',').map(x => x.trim()).filter(Boolean))];
    if (!names.length) return setError('Enter at least one person name.');
    const existing = new Set(people.map(x => x.name.toLowerCase()));
    const fresh = names.filter(x => !existing.has(x.toLowerCase())).map(name => ({ household_id: householdId, name }));
    if (!fresh.length) return setError('Those people are already in this household.');
    const { error: err } = await supabase.from('people').insert(fresh);
    if (err) setError(err.message); else { setPeopleNames(''); setShowSetup(''); await load(); }
  }

  async function saveTerm() {
    if (!termName.trim()) return setError('Enter a period name.');
    const months = [...new Set(termMonths.split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x) && x >= 1 && x <= 12))];
    if (!months.length) return setError('Enter valid months from 1 to 12, separated by commas.');
    const { error: err } = await supabase.from('terms').insert({ household_id: householdId, name: termName.trim(), months, sort_order: terms.length + 1 });
    if (err) setError(err.message); else { setTermName(''); setShowSetup(''); await load(); }
  }

  if (busy) return <Page><Loading label="Loading household ledger…"/></Page>;
  return <Page>
    <Heading subtitle="Shared household finances">{household?.name || 'Household'}</Heading>
    {error ? <Notice tone="error">{error}</Notice> : null}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Expenses</Text><Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{money(expenses.reduce((s, x) => s + Number(x.amount || 0), 0), household?.currency)}</Text></Card>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Obligations</Text><Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{obligations.length}</Text></Card>
    </View>
    {pending > 0 ? <Notice tone="info">{pending} household expense(s) waiting to sync. Keep the app installed and reconnect to the internet.</Notice> : null}
    <Card><Heading subtitle={monthLabel(viewMonth)}>Household budget overview</Heading>{(() => { const monthRows=expenses.filter(e=>monthKey(e.date)===viewMonth), cap=computeMonthlyTotal(household?.monthly_budget,expenses,categories,viewMonth), total=monthRows.reduce((s,e)=>s+Number(e.amount||0),0); return <><Text style={{color:colors.text,fontSize:22,fontWeight:'800'}}>{money(total,household?.currency)} spent</Text><View style={{height:120,flexDirection:'row',alignItems:'flex-end',gap:8,paddingTop:10}}>{monthlyTotals(expenses,viewMonth,6).map(m=>{const series=monthlyTotals(expenses,viewMonth,6),max=Math.max(1,...series.map(x=>x.total));return <View key={m.month} style={{flex:1,alignItems:'center',justifyContent:'flex-end',height:'100%'}}><View style={{width:'70%',height:Math.max(3,90*m.total/max),backgroundColor:m.month===viewMonth?colors.accent:colors.border,borderRadius:4}}/><Text style={{color:colors.textFaint,fontSize:9,marginTop:4}}>{m.month.slice(5)}</Text></View>;})}</View>{cap?<><Text style={{color:colors.textDim}}>Monthly cap {money(cap.budget,household?.currency)} · {money(cap.remaining,household?.currency)} remaining</Text><View style={{height:8,backgroundColor:colors.surface2,borderRadius:8,overflow:'hidden'}}><View style={{height:8,width:`${Math.min(100,cap.spent/cap.budget*100)}%`,backgroundColor:cap.remaining<0?colors.negative:colors.accent}}/></View></>:<Text style={{color:colors.textFaint}}>No monthly cap set.</Text>}{categories.filter(c=>!c.archived&&c.budget_amount!=null&&c.budget_period).map(c=>{const b=computeBudget(c,expenses.filter(e=>e.category===c.name),viewMonth,terms);return <View key={c.id} style={{paddingVertical:6}}><Text style={{color:colors.text,fontWeight:'600'}}>{c.name} · {c.budget_period}</Text><Text style={{color:colors.textDim,fontSize:12}}>{b.active?`${money(b.spent,household?.currency)} / ${money(b.budget,household?.currency)} · ${money(b.remaining,household?.currency)} remaining`:b.reason}</Text></View>;})}</>; })()}</Card>
    <Button title={showExpenseForm ? 'Close expense form' : '＋ Add household expense'} onPress={() => setShowExpenseForm(v => !v)}/>
    {showExpenseForm ? <Card><Heading>{editingExpenseId ? 'Edit expense' : 'New expense'}</Heading><Field label="AMOUNT" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00"/><Field label="CATEGORY" value={category} onChangeText={setCategory} placeholder={categories.map(c => c.name).join(', ') || 'Category'}/><Field label="RECIPIENT" value={recipient} onChangeText={setRecipient} placeholder="Paid to"/><Field label="NOTE" value={note} onChangeText={setNote} placeholder="Optional note"/><Field label="REFERENCE" value={expenseReference} onChangeText={setExpenseReference} placeholder="Optional reference"/><Field label="DATE" value={expenseDate} onChangeText={setExpenseDate} placeholder="YYYY-MM-DDTHH:mm"/><Button title={editingExpenseId ? 'Save changes' : 'Save expense'} onPress={saveExpense}/><Button title="Cancel" variant="secondary" onPress={()=>{setShowExpenseForm(false);setEditingExpenseId(null);}}/></Card> : null}
    <Card><Heading subtitle="Manage the shared ledger setup">Expense types, quick entries and people</Heading>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button title="＋ Expense type" onPress={() => setShowSetup(showSetup === 'category' ? '' : 'category')}/>
        <Button title="＋ Quick entry" variant="secondary" onPress={() => setShowSetup(showSetup === 'quick' ? '' : 'quick')}/>
        <Button title="＋ People" variant="secondary" onPress={() => setShowSetup(showSetup === 'people' ? '' : 'people')}/>
        <Button title="＋ Period" variant="secondary" onPress={() => setShowSetup(showSetup === 'term' ? '' : 'term')}/>
      </View>
      {showSetup === 'category' ? <View style={{ gap: 8 }}><Heading>{editingCategoryId ? 'Edit expense type' : 'New expense type'}</Heading><Field label="EXPENSE NAME" value={newCategory} onChangeText={setNewCategory} placeholder="e.g. School fees"/><Field label="BUDGET AMOUNT" value={budgetAmount} onChangeText={setBudgetAmount} keyboardType="decimal-pad" placeholder="Leave blank for no budget"/><Text style={{ color: colors.textDim, fontSize: 12 }}>Budget period: {budgetPeriod === 'none' ? 'No budget' : budgetPeriod === 'monthly' ? 'Per month' : budgetPeriod === 'termly' ? 'Per term / period' : 'Per year'}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{[['none','No budget'],['monthly','Per month'],['termly','Per term'],['yearly','Per year']].map(([v,l]) => <Pressable key={v} onPress={() => setBudgetPeriod(v)} style={{ padding: 9, borderRadius: 9, backgroundColor: budgetPeriod === v ? colors.accent : colors.surface2 }}><Text style={{ color: budgetPeriod === v ? '#fff' : colors.text, fontSize: 12 }}>{l}</Text></Pressable>)}</View><Pressable onPress={()=>setBudgetRollover(v=>!v)}><Text style={{color:colors.text}}>{budgetRollover?'☑':'☐'} Carry unused budget forward</Text></Pressable><Pressable onPress={()=>setExcludeFromTotal(v=>!v)}><Text style={{color:colors.text}}>{excludeFromTotal?'☑':'☐'} Exclude from monthly cap</Text></Pressable><Button title={editingCategoryId ? 'Save changes' : 'Save expense type'} onPress={saveCategory}/><Button title="Cancel" variant="secondary" onPress={()=>{setEditingCategoryId(null);setShowSetup('');}}/></View> : null}
      {showSetup === 'quick' ? <View style={{ gap: 8 }}><Heading>{editingTemplateId?'Edit quick entry':'New quick entry'}</Heading><Field label="LABEL" value={quickLabel} onChangeText={setQuickLabel} placeholder="e.g. Weekly groceries"/><Field label="AMOUNT" value={quickAmount} onChangeText={setQuickAmount} keyboardType="decimal-pad" placeholder="0.00"/><Field label="EXPENSE TYPE" value={quickCategory} onChangeText={setQuickCategory} placeholder={categories.map(c => c.name).join(', ') || 'Category'}/><Field label="PEOPLE (COMMA SEPARATED)" value={quickPeople} onChangeText={setQuickPeople} placeholder="e.g. Teddy, Jane"/><Field label="RECURRING BILL DUE DAY (1–31, OPTIONAL)" value={quickDueDay} onChangeText={setQuickDueDay} keyboardType="number-pad" placeholder="e.g. 5"/><Button title={editingTemplateId?'Save changes':'Save quick entry'} onPress={saveQuickEntry}/><Button title="Cancel" variant="secondary" onPress={()=>{setEditingTemplateId(null);setShowSetup('');}}/></View> : null}
      {showSetup === 'people' ? <View style={{ gap: 8 }}><Heading>Add household people</Heading><Field label="NAMES (COMMA SEPARATED)" value={peopleNames} onChangeText={setPeopleNames} placeholder="e.g. Teddy, Jane, Brian"/><Button title="Save people" onPress={savePeople}/></View> : null}
      {showSetup === 'term' ? <View style={{ gap: 8 }}><Heading>Add payment period</Heading><Field label="PERIOD NAME" value={termName} onChangeText={setTermName} placeholder="e.g. Term 1"/><Field label="MONTHS (1–12, COMMA SEPARATED)" value={termMonths} onChangeText={setTermMonths} placeholder="1,2,3,4"/><Button title="Save period" onPress={saveTerm}/></View> : null}
      <Text style={{ color: colors.textFaint, fontSize: 12 }}>Expense types: {categories.length} · People: {people.length} · Quick entries: {templates.length} · Periods: {terms.length}</Text>
      {categories.map(c => <View key={c.id} style={{paddingVertical:6}}><Text style={{ color: colors.textDim, fontSize: 12 }}>• {c.name}{c.budget_amount != null ? ` · ${money(c.budget_amount, household?.currency)} ${c.budget_period || ''}` : ' · No budget'}</Text><View style={{flexDirection:'row',gap:7}}><Button title="Edit" variant="secondary" onPress={()=>{setEditingCategoryId(c.id);setNewCategory(c.name);setBudgetAmount(c.budget_amount==null?'':String(c.budget_amount));setBudgetPeriod(c.budget_period||'none');setBudgetRollover(c.budget_rollover!==false);setExcludeFromTotal(!!c.exclude_from_total);setShowSetup('category');}}/><Button title={c.archived?"Restore":"Archive"} variant={c.archived?"secondary":"danger"} onPress={()=>Alert.alert(c.archived?'Restore expense type?':'Archive expense type?',`${c.archived?'Show':'Hide'} ${c.name} ${c.archived?'in':'from'} new entries?`,[{text:'Cancel',style:'cancel'},{text:c.archived?'Restore':'Archive',onPress:async()=>{const{error}=await supabase.from('categories').update({archived:!c.archived}).eq('id',c.id);if(error)setError(error.message);else load();}}])}/></View></View>)}
      {templates.map(t => <View key={t.id} style={{paddingVertical:4}}><Text style={{ color: colors.textDim, fontSize: 12 }}>• {t.label} · {money(t.amount, household?.currency)}{t.recipient ? ` · ${t.recipient}` : ''}{t.due_day ? ` · Due day ${t.due_day}` : ''}</Text><Button title="Edit quick entry" variant="secondary" onPress={()=>{setEditingTemplateId(t.id);setQuickLabel(t.label);setQuickAmount(String(t.amount));setQuickCategory(t.category);setQuickPeople(t.recipient||'');setQuickDueDay(t.due_day?String(t.due_day):'');setShowSetup('quick');}}/><Button title="Use quick entry" variant="secondary" onPress={()=>{setAmount(String(t.amount));setCategory(t.category);setRecipient(t.recipient||'');setNote(t.label);setEditingExpenseId(null);setShowExpenseForm(true);}}/><Button title="Delete quick entry" variant="danger" onPress={()=>deleteSetupRow('templates',t,'quick entry')}/></View>)}
      {people.map(person => <View key={person.id} style={{paddingVertical:4}}><Text style={{ color: colors.textDim, fontSize: 12 }}>• {person.name}</Text><Button title="Remove person" variant="danger" onPress={()=>deleteSetupRow('people',person,'person')}/></View>)}
      {terms.map(term => <View key={term.id} style={{paddingVertical:4}}><Text style={{ color: colors.textDim, fontSize: 12 }}>• {term.name} · months {term.months?.join(', ')}</Text><Button title="Delete period" variant="danger" onPress={()=>deleteSetupRow('terms',term,'payment period')}/></View>)}
    </Card>
    <Card><Heading subtitle={`${expenses.length} latest records`}>Household expenses</Heading><View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Button title="‹" variant="secondary" onPress={()=>{const[y,m]=viewMonth.split('-').map(Number),d=new Date(y,m-2,1);setViewMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}}/><Text style={{color:colors.text,fontWeight:'700'}}>{monthLabel(viewMonth)}</Text><Button title="›" variant="secondary" onPress={()=>{const[y,m]=viewMonth.split('-').map(Number),d=new Date(y,m,1);setViewMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}}/></View>{expenses.filter(x=>monthKey(x.date)===viewMonth).length ? expenses.filter(x=>monthKey(x.date)===viewMonth).map(x => <View key={x.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap:4 }}><Text style={{ color: colors.text, fontWeight: '600' }}>{x.category || x.recipient || 'Expense'}</Text><Text style={{ color: colors.textFaint, fontSize: 12 }}>{x.date ? new Date(x.date).toLocaleDateString() : ''} · {x.note || x.recipient || ''}</Text><Text style={{ color: colors.text, fontWeight: '700', marginTop: 3 }}>{money(x.amount, household?.currency)}</Text><View style={{flexDirection:'row',gap:8}}><Button title="Edit amount" variant="secondary" onPress={()=>editExpense(x)}/><Button title="Delete" variant="danger" onPress={()=>deleteExpense(x)}/></View></View>) : <Empty>No household expenses recorded for this month.</Empty>}<Button title="Export monthly CSV" onPress={()=>exportCSV(`household-${viewMonth}.csv`,expenses.filter(x=>monthKey(x.date)===viewMonth)).catch(e=>setError(e.message))}/><Button title="Generate monthly PDF" variant="secondary" onPress={()=>{const rows=expenses.filter(x=>monthKey(x.date)===viewMonth),total=rows.reduce((s,x)=>s+Number(x.amount||0),0),byCategory=Object.values(rows.reduce((a,x)=>{const k=x.category||'Other';a[k]??={name:k,total:0};a[k].total+=Number(x.amount||0);return a;},{}));const payerMap=rows.reduce((a,x)=>{const k=x.paid_by_user_id||'unattributed',label=x.paid_by_label||(x.paid_by_user_id===undefined?'Not recorded':'Unknown');a[k]??={label,total:0,count:0};a[k].total+=Number(x.amount||0);a[k].count++;return a;},{});const byPayer=Object.values(payerMap).sort((a,b)=>b.total-a.total);exportPDF({title:household?.name||'Household Ledger',subtitle:monthLabel(viewMonth),rows,total,currency:household?.currency||'KES',byCategory,byPayer}).catch(e=>setError(e.message));}}/></Card>
    <Card><Heading>Household monthly cap</Heading><Field label="MONTHLY CAP" value={monthlyCap} onChangeText={setMonthlyCap} keyboardType="decimal-pad" placeholder="Leave blank for no cap"/><Button title="Save monthly cap" onPress={saveMonthlyCap}/></Card>
    <Card><Heading>Obligations</Heading><Field label="OBLIGATION TITLE" value={obligationTitle} onChangeText={setObligationTitle} placeholder="e.g. School fees"/><Field label="TOTAL AMOUNT" value={obligationAmount} onChangeText={setObligationAmount} keyboardType="decimal-pad" placeholder="0.00"/><Button title="Add obligation" onPress={createObligation}/>{obligations.length ? obligations.map(o => {const paid=expenses.filter(e=>e.obligation_id===o.id).reduce((sum,e)=>sum+Number(e.amount||0),0),remaining=Math.max(0,Number(o.total_amount||0)-paid);return <View key={o.id} style={{ paddingVertical: 9,borderBottomWidth:1,borderBottomColor:colors.border,gap:5 }}><Text style={{ color: colors.text, fontWeight: '600' }}>{o.title}</Text><Text style={{ color: colors.textFaint }}>Total {money(o.total_amount, household?.currency)} · Paid {money(paid,household?.currency)} · Remaining {money(remaining,household?.currency)}</Text>{remaining>0?<Button title="Record payment" variant="secondary" onPress={()=>{setPaymentFor(o);setPaymentAmount('');setPaymentReference('');}}/>:null}<Button title="Delete obligation" variant="danger" onPress={()=>deleteObligation(o)}/>{paymentFor?.id===o.id?<View style={{gap:7}}><Field label="PAYMENT AMOUNT" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad"/><Field label="REFERENCE" value={paymentReference} onChangeText={setPaymentReference}/><Button title="Save payment" onPress={saveObligationPayment}/><Button title="Cancel" variant="secondary" onPress={()=>setPaymentFor(null)}/></View>:null}</View>;}) : <Empty/>}</Card>
    <Card><Heading>Household activity history</Heading><Text style={{color:colors.textFaint,fontSize:12}}>{audit.length} recent records</Text>{audit.slice(0,30).map(a=><View key={a.id} style={{paddingVertical:7,borderBottomWidth:1,borderBottomColor:colors.border}}><Text style={{color:colors.text,fontWeight:'600'}}>{a.action} · {a.entity}</Text><Text style={{color:colors.textDim,fontSize:12}}>{a.summary||''} · {a.user_email||''}</Text><Text style={{color:colors.textFaint,fontSize:11}}>{a.created_at?new Date(a.created_at).toLocaleString():''}</Text></View>)}</Card>
    <Button title="Refresh household" variant="secondary" onPress={load}/>
  </Page>;
}
