import {redirect} from 'next/navigation';
import {database} from '@/lib/supabase';
import {isAiAdmin} from '@/lib/ai-admin';
import {WorkspaceHeader} from '../workspace-header';
import {KnowledgeManager} from './knowledge-manager';
import './manage.css';
export const dynamic='force-dynamic';
export const metadata={title:'内容管理',robots:{index:false,follow:false}};
export default async function Manage(){
 const db=await database();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 return <><WorkspaceHeader account={{email:user.email,avatarUrl:user.user_metadata?.avatar_url||user.user_metadata?.picture,displayName:user.user_metadata?.name,showAdmin:isAiAdmin(user.id)}}/><main className="knowledge-manager"><KnowledgeManager/></main></>;
}
