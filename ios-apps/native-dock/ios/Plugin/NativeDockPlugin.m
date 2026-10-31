#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeDockPlugin, "NativeDock",
           CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
)
