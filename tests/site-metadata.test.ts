import test from 'node:test';
import assert from 'node:assert/strict';
import {siteOrigin,isPublicProduction,siteMetadata,siteStructuredData} from '../lib/site-metadata';
test('canonical origins prefer the configured domain and never contain paths or credentials',()=>{
  assert.equal(siteOrigin({NEXT_PUBLIC_SITE_URL:'https://cheese.example/saved?q=1',VERCEL_PROJECT_PRODUCTION_URL:'fallback.vercel.app'})?.href,'https://cheese.example/');
  assert.equal(siteOrigin({VERCEL_PROJECT_PRODUCTION_URL:'cheese.vercel.app',VERCEL_URL:'preview.vercel.app'})?.href,'https://cheese.vercel.app/');
  assert.equal(siteOrigin({NEXT_PUBLIC_SITE_URL:'https://user:secret@cheese.example'}),null);
  assert.equal(siteOrigin({NEXT_PUBLIC_SITE_URL:'file:///etc/hosts'}),null);
});
test('only a public production deployment is indexable',()=>{
  assert.equal(isPublicProduction({NEXT_PUBLIC_SITE_URL:'https://cheese.example',VERCEL_ENV:'production'}),true);
  assert.equal(isPublicProduction({NEXT_PUBLIC_SITE_URL:'https://cheese.example',VERCEL_ENV:'preview'}),false);
  assert.equal(isPublicProduction({NEXT_PUBLIC_SITE_URL:'http://localhost:3000'}),false);
  assert.equal(isPublicProduction({}),false);
});
test('social metadata uses public brand assets and structured data contains no account content',()=>{
  const env={NEXT_PUBLIC_SITE_URL:'https://cheese.example',VERCEL_ENV:'production'};
  const metadata=siteMetadata(env);
  assert.ok(metadata.metadataBase instanceof URL);
  assert.equal(metadata.metadataBase.origin,'https://cheese.example');
  assert.ok(metadata.twitter && 'card' in metadata.twitter);
  assert.equal(metadata.twitter.card,'summary_large_image');
  assert.ok(metadata.icons);assert.ok(metadata.openGraph?.images);
  const structured=siteStructuredData(env)!;
  assert.equal(structured['@graph'][0].url,'https://cheese.example/');
  assert.equal(structured['@graph'].length,2);
});
