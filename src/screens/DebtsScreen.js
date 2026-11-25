import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { Button, Card, Empty, Field, Heading, Loading, Notice, Page } from '../components/UI';
import { colors } from '../theme/colors';

const money = n => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const remainingFor = (debt, payments) => Math.max(0, Number(debt.total_repayable ?? debt.principal ?? 0) - payments.filter(p => p.debt_id === debt.id).reduce((s, p) => s + Number(p.amount || 0), 0));

export default function DebtsScreen({ session }) {
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [direction, setDirection] = useState('owe');
  const [counterparty, setCounterparty] = useState('');
  const [principal, setPrincipal] = useState('');
  const [totalRepayable, setTotalRepayable] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentDebt, setPaymentDebt] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [expenseCategory, setExpenseCategory] = useState('');
  const [incomeCategory, setIncomeCategory] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString());
  const [paymentReference, setPaymentReference] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: err } = await supabase.from('debts').select('*').eq('scope', 'personal').eq('user_id', session.user.id).order('created_at', { ascending: false });
    if (err) setError(err.message);
    const rows = data || []; setDebts(rows);
    if (rows.length) {
      const { data: p, error: pErr } = await supabase.from('debt_payments').select('*').in('debt_id', rows.map(x => x.id)).order('date', { ascending: false });
      if (pErr) setError(pErr.message);
      setPayments(p || []);
    } else setPayments([]);
    setLoading(false);
  }, [session.user.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totals = useMemo(() => debts.reduce((a, d) => {
    const left = remainingFor(d, payments);
    if (d.status !== 'cleared' && d.direction === 'owe') a.owe += left;
    if (d.status !== 'cleared' && d.direction === 'owed') a.owed += left;
    return a;
  }, { owe: 0, owed: 0 }), [debts, payments]);

  async function createDebt() {
    const amount = Number(principal);
    if (!counterparty.trim()) return setError("Enter the other person's name or organisation.");
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a principal amount greater than zero.');
    const repayable = totalRepayable.trim() ? Number(totalRepayable) : null;
    if (repayable !== null && (!Number.isFinite(repayable) || repayable < amount)) return setError('Total repayable must be at least the principal amount.');
    setWorking(true); setError('');
    const payload = { scope:'personal', user_id:session.user.id, household_id:null, direction, counterparty:counterparty.trim(), principal:amount, total_repayable:repayable, due_date:dueDate.trim()||null, notes:notes.trim(), expense_category:direction==='owe'?(expenseCategory.trim()||null):null, income_category:direction==='owed'?(incomeCategory.trim()||null):null, status:'active', created_by:session.user.id };
    const { error: err } = editingId ? await supabase.from('debts').update(payload).eq('id',editingId) : await supabase.from('debts').insert(payload);
    if (err) setError(err.message);
    else { setCounterparty(''); setPrincipal(''); setTotalRepayable(''); setDueDate(''); setNotes(''); setExpenseCategory(''); setIncomeCategory(''); setEditingId(null); setShowForm(false); setNotice(editingId?'Debt updated.':'Debt record created.'); await load(); }
    setWorking(false);
  }

  async function recordPayment() {
    const amount = Number(paymentAmount), debt = debts.find(d => d.id === paymentDebt);
    if (!debt) return;
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a repayment amount greater than zero.');
    const remaining = remainingFor(debt, payments);
    if (amount > remaining + 0.001) return setError(`Payment exceeds the outstanding balance of ${money(remaining)}.`);
    setWorking(true); setError('');
    let personalExpenseId=null, incomeId=null;
    const shouldPostExpense = debt.direction==='owe' && debt.expense_category;
    const shouldPostIncome = debt.direction==='owed' && debt.income_category;
    if (shouldPostExpense) {
      const {data,error}=await supabase.from('personal_expenses').insert({user_id:session.user.id,amount,category:debt.expense_category,note:`Debt payment - ${debt.counterparty}`,reference:paymentReference.trim(),date:paymentDate}).select('id').single();
      if(error){setError(`Couldn't add matching expense: ${error.message}`);setWorking(false);return;} personalExpenseId=data.id;
    }
    if (shouldPostIncome) {
      const {data,error}=await supabase.from('income').insert({scope:'personal',user_id:session.user.id,household_id:null,amount,category:debt.income_category,source:debt.counterparty,note:`Repayment - ${debt.counterparty}`,reference:paymentReference.trim(),date:paymentDate,created_by:session.user.id}).select('id').single();
      if(error){if(personalExpenseId)await supabase.from('personal_expenses').delete().eq('id',personalExpenseId);setError(`Couldn't add matching income: ${error.message}`);setWorking(false);return;} incomeId=data.id;
    }
    const {error}=await supabase.from('debt_payments').insert({debt_id:debt.id,amount,date:paymentDate,note:paymentNote.trim(),reference:paymentReference.trim(),personal_expense_id:personalExpenseId,income_id:incomeId,created_by:session.user.id});
    if(error){if(personalExpenseId)await supabase.from('personal_expenses').delete().eq('id',personalExpenseId);if(incomeId)await supabase.from('income').delete().eq('id',incomeId);setError(`Couldn't record payment: ${error.message}`);}
    else {if(amount>=remaining-0.001)await supabase.from('debts').update({status:'cleared'}).eq('id',debt.id);setPaymentDebt(null);setPaymentAmount('');setPaymentNote('');setPaymentReference('');setPaymentDate(new Date().toISOString());setNotice('Repayment recorded.');await load();}
    setWorking(false);
  }
  async function deleteDebt(debt) {
    Alert.alert('Delete debt?',`Delete ${debt.counterparty}, its payment history and linked ledger entries?`,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const ps=payments.filter(p=>p.debt_id===debt.id);const per=ps.map(p=>p.personal_expense_id).filter(Boolean),inc=ps.map(p=>p.income_id).filter(Boolean);if(per.length){const r=await supabase.from('personal_expenses').delete().in('id',per);if(r.error)return setError(r.error.message);}if(inc.length){const r=await supabase.from('income').delete().in('id',inc);if(r.error)return setError(r.error.message);}const{error}=await supabase.from('debts').delete().eq('id',debt.id);if(error)setError(error.message);else load();}}]);
  }
  async function deletePayment(payment) {
    Alert.alert('Delete repayment?', 'The linked expense or income record will also be removed.', [{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{if(payment.personal_expense_id){const r=await supabase.from('personal_expenses').delete().eq('id',payment.personal_expense_id);if(r.error)return setError(r.error.message);}if(payment.income_id){const r=await supabase.from('income').delete().eq('id',payment.income_id);if(r.error)return setError(r.error.message);}const{error}=await supabase.from('debt_payments').delete().eq('id',payment.id);if(error)setError(error.message);else load();}}]);
  }

  if (loading) return <Page><Loading label="Loading debts…"/></Page>;
  const active = debts.filter(d => d.status !== 'cleared');
  return <Page>
    <Heading subtitle="Track money you owe and money owed to you">Debts</Heading>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>You owe</Text><Text style={{ color: colors.negative, fontSize: 19, fontWeight: '800' }}>{money(totals.owe)}</Text></Card>
      <Card style={{ flex: 1 }}><Text style={{ color: colors.textFaint, fontSize: 12 }}>Owed to you</Text><Text style={{ color: colors.positive, fontSize: 19, fontWeight: '800' }}>{money(totals.owed)}</Text></Card>
    </View>
    <Button title={showForm ? 'Close debt form' : '＋ Add debt'} onPress={() => { setShowForm(v => !v); setError(''); }}/>
    {showForm ? <Card>
      <Heading>{editingId?'Edit debt record':'New debt record'}</Heading>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['owe','owed'].map(v => <Pressable key={v} onPress={() => setDirection(v)} style={{ flex: 1, borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: direction === v ? colors.accent : colors.surface2, borderWidth: 1, borderColor: direction === v ? colors.accent : colors.border }}><Text style={{ color: direction === v ? '#fff' : colors.text, fontWeight: '700' }}>{v === 'owe' ? 'I owe' : 'Owed to me'}</Text></Pressable>)}
      </View>
      <Field label="PERSON / ORGANISATION" value={counterparty} onChangeText={setCounterparty} placeholder="Name"/>
      <Field label="PRINCIPAL AMOUNT (KES)" value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" placeholder="0.00"/>
      <Field label="TOTAL REPAYABLE (KES)" value={totalRepayable} onChangeText={setTotalRepayable} keyboardType="decimal-pad" placeholder="Leave blank to use principal"/>
      <Field label="DUE DATE (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-12-31"/>
      <Field label="NOTES" value={notes} onChangeText={setNotes} placeholder="Optional details" multiline />
      {direction === 'owe' ? <Field label="EXPENSE CATEGORY (OPTIONAL; POSTS REPAYMENTS TO PERSONAL EXPENSES)" value={expenseCategory} onChangeText={setExpenseCategory} placeholder="Use an existing personal expense category" /> : <Field label="INCOME CATEGORY (OPTIONAL; POSTS REPAYMENTS TO INCOME)" value={incomeCategory} onChangeText={setIncomeCategory} placeholder="Use an existing income category" />}
      <Button title={editingId?"Save debt changes":"Save debt"} onPress={createDebt} loading={working}/><Button title="Cancel" variant="secondary" onPress={()=>{setShowForm(false);setEditingId(null);}}/>
    </Card> : null}
    <Card><Heading subtitle={`${active.length} active records`}>Outstanding debts</Heading>{debts.length ? debts.map(d => {
      const remaining = remainingFor(d, payments);
      const paid = Math.max(0, Number(d.total_repayable ?? d.principal ?? 0) - remaining);
      return <View key={d.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{d.direction === 'owe' ? 'You owe' : 'Owed to you'} · {d.counterparty}</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12 }}>{d.status === 'cleared' ? 'Cleared' : 'Active'}{d.due_date ? ` · Due ${d.due_date}` : ''}</Text>
        <Text style={{ color: d.direction === 'owed' ? colors.positive : colors.text, fontWeight: '800', fontSize: 18 }}>{money(remaining)} remaining</Text>
        <Text style={{ color: colors.textFaint, fontSize: 12 }}>Original {money(d.total_repayable ?? d.principal)} · Paid {money(paid)}</Text>
        {d.notes ? <Text style={{ color: colors.textDim, fontSize: 12 }}>{d.notes}</Text> : null}<View style={{flexDirection:'row',gap:8}}><Button title="Edit" variant="secondary" onPress={()=>{setEditingId(d.id);setDirection(d.direction);setCounterparty(d.counterparty||'');setPrincipal(String(d.principal||''));setTotalRepayable(d.total_repayable==null?'':String(d.total_repayable));setDueDate(d.due_date||'');setNotes(d.notes||'');setExpenseCategory(d.expense_category||'');setIncomeCategory(d.income_category||'');setShowForm(true);}}/><Button title="Delete" variant="danger" onPress={()=>deleteDebt(d)}/></View>
        {d.status !== 'cleared' ? <Button title="＋ Record repayment" variant="secondary" onPress={() => { setPaymentDebt(d.id); setPaymentAmount(''); setPaymentNote(''); setPaymentDate(new Date().toISOString()); setPaymentReference(''); setError(''); }}/> : null}
        {paymentDebt === d.id ? <View style={{ gap: 8, marginTop: 8 }}><Field label="PAYMENT AMOUNT (KES)" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" placeholder="0.00"/><Field label="NOTE" value={paymentNote} onChangeText={setPaymentNote} placeholder="Optional"/><Field label="REFERENCE" value={paymentReference} onChangeText={setPaymentReference} placeholder="Optional reference"/><Field label="DATE (ISO OR YYYY-MM-DD)" value={paymentDate} onChangeText={setPaymentDate}/><Button title="Save repayment" onPress={recordPayment} loading={working}/><Button title="Cancel" variant="secondary" onPress={() => setPaymentDebt(null)}/></View> : null}
      </View>;
    }) : <Empty>No personal debts recorded.</Empty>}</Card>
    <Card><Heading subtitle={`${payments.length} transactions`}>Recent repayments</Heading>{payments.length ? payments.slice(0, 30).map(p => <View key={p.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}><Text style={{ color: colors.text, fontWeight: '600' }}>{money(p.amount)}</Text><Text style={{ color: colors.textFaint, fontSize: 12 }}>{p.date ? new Date(p.date).toLocaleDateString() : ''}{p.note ? ` · ${p.note}` : ''}</Text><Button title="Delete repayment" variant="danger" onPress={()=>deletePayment(p)}/></View>) : <Empty>No repayments recorded.</Empty>}</Card>
    <Button title="Refresh" variant="secondary" onPress={load}/>
  </Page>;
}
