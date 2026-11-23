import { NextResponse, type NextRequest } from 'next/server';
import { oauthSignIn } from '../actions';
import { database, supabaseConfig } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  // Cookie-authenticated mutations must originate in this application.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({error:'请求来源无效，请刷新页面重试。'},{status:403});
  }
  try {
    const form=await request.formData();
    const operation=form.get('operation');
    if(operation==='oauth') return NextResponse.json(await oauthSignIn({},form));
    if(operation==='logout') {
      if(!supabaseConfig()) return NextResponse.json({error:'登录服务尚未配置。'});
      const {error}=await (await database()).auth.signOut({scope:'local'});
      return NextResponse.json(error?{error:'暂时无法退出，请重试。'}:{ok:true});
    }
    return NextResponse.json({error:'不支持的账号操作。'},{status:400});
  } catch {
    return NextResponse.json({error:'暂时无法连接登录服务，请稍后重试。'},{status:503});
  }
}
