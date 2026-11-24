import {database,supabaseConfig} from '@/lib/supabase';
import {WorkspaceHeader} from '@/app/workspace-header';
import {CaptureImport} from './capture-import';
import '@/app/manage/manage.css';
export const dynamic='force-dynamic';
export const metadata={title:'浏览器采集',robots:{index:false,follow:false}};
export default async function CaptureImportPage(){const user=supabaseConfig()?(await (await database()).auth.getUser()).data.user:null;return <><WorkspaceHeader/><main className="frame" style={{paddingBlock:40}}><CaptureImport signedIn={Boolean(user)}/></main></>;}
