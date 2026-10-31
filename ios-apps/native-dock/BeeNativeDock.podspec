Pod::Spec.new do |s|
  s.name = 'BeeNativeDock'
  s.version = '1.0.0'
  s.summary = 'Native iOS tab bar (Liquid Glass on iOS 26+) for the Bee Hive apps'
  s.license = 'MIT'
  s.homepage = 'https://github.com/plodroid/store'
  s.author = 'plodroid'
  s.source = { :git => 'https://github.com/plodroid/store.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
