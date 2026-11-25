import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
const KEY='expense-tracker-pending-writes';
let flushing=false;
export async function readQueue(){try{return JSON.parse((await AsyncStorage.getItem(KEY))||'[]');}catch{return[];}}
export async function enqueue(op){const q=await readQueue();q.push({...op,queuedAt:Date.now(),queueId:`${Date.now()}-${Math.random().toString(36).slice(2)}`});await AsyncStorage.setItem(KEY,JSON.stringify(q));return q.length;}
export async function flushQueue(){if(flushing)return{pending:(await readQueue()).length};const net=await NetInfo.fetch();if(!net.isConnected)return{offline:true,pending:(await readQueue()).length};const q=await readQueue();if(!q.length)return{pending:0};flushing=true;const failed=[];try{for(const op of q){let req=supabase.from(op.table);if(op.action==='update')req=req.update(op.payload).eq('id',op.id);else if(op.action==='delete')req=req.delete().eq('id',op.id);else req=req.insert(op.payload);const{error}=await req;if(error)failed.push({...op,lastError:error.message});}await AsyncStorage.setItem(KEY,JSON.stringify(failed));return{pending:failed.length,synced:q.length-failed.length,failed};}finally{flushing=false;}}
export async function pendingCount(){return(await readQueue()).length;}
