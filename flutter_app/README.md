# AttendTracker (Flutter)

Standalone Flutter mobile app for attendance tracking. **Zero connection** to any website — 100% on-device storage.

## Requirements
- Flutter SDK 3.19+ (`flutter --version`)
- Android Studio or VS Code with Flutter & Dart extensions
- Android emulator / iOS simulator / physical device

## Run
```bash
cd flutter_app
flutter pub get
flutter run
```

## Build release APK
```bash
flutter build apk --release
# output: build/app/outputs/flutter-apk/app-release.apk
```

## Features (v1)
- Dashboard with animated hero ring (overall attendance %)
- Subjects: add / edit / delete
- Mark present / absent / cancelled per subject
- Auto-calculated "can I skip?" / "must attend" projection
- Local persistence (shared_preferences, no cloud, no login)
- Aurora Glass dark theme + smooth transitions
- Local notifications (daily attendance nudge)

## Project structure
```
lib/
  main.dart
  theme/aurora_theme.dart
  models/subject.dart
  services/storage_service.dart
  services/notification_service.dart
  screens/
    dashboard_screen.dart
    subjects_screen.dart
    add_subject_screen.dart
    settings_screen.dart
  widgets/
    glass_card.dart
    hero_ring.dart
    subject_tile.dart
```

## Change app name / icon
- Name shown to user: `AndroidManifest.xml` → `android:label` (already "AttendTracker")
- iOS name: `ios/Runner/Info.plist` → `CFBundleName`
- Icon: use `flutter_launcher_icons` package after placing `assets/icon.png`
