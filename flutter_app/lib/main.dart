import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme/aurora_theme.dart';
import 'screens/dashboard_screen.dart';
import 'services/storage_service.dart';
import 'services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));
  await StorageService.instance.init();
  await NotificationService.instance.init();
  runApp(const AttendTrackerApp());
}

class AttendTrackerApp extends StatelessWidget {
  const AttendTrackerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AttendTracker',
      debugShowCheckedModeBanner: false,
      theme: AuroraTheme.dark(),
      home: const DashboardScreen(),
    );
  }
}
