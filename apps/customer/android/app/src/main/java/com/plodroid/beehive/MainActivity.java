package com.plodroid.beehive;

import android.os.Bundle;

import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        // always load the newest website, never an old copy kept by the web view (the site is the app)
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView w = getBridge().getWebView();
            w.clearCache(true);
            w.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
    }
}
