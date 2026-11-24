import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['jsdom', 'ffmpeg-static', '@napi-rs/canvas'],
  outputFileTracingIncludes: {'/*': ['./node_modules/ffmpeg-static/ffmpeg','./public/service-probe/*']},
};

export default config;
