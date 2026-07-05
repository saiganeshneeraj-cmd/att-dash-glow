import 'package:flutter/material.dart';
import '../services/storage_service.dart';
import '../services/notification_service.dart';
import '../theme/aurora_theme.dart';
import '../widgets/glass_card.dart';
import '../widgets/hero_ring.dart';
import '../widgets/subject_tile.dart';
import 'add_subject_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final storage = StorageService.instance;

  @override
  void initState() {
    super.initState();
    storage.addListener(_onChange);
  }

  @override
  void dispose() {
    storage.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final subjects = storage.subjects;
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('AttendTracker',
            style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: -0.5)),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => NotificationService.instance.showTest(
              'AttendTracker',
              'Overall: ${storage.overallPercentage.toStringAsFixed(1)}%',
            ),
          ),
        ],
      ),
      body: Stack(
        children: [
          _AuroraBackground(),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
              children: [
                const SizedBox(height: 8),
                GlassCard(
                  padding: const EdgeInsets.symmetric(vertical: 28),
                  child: Center(
                    child: HeroRing(percentage: storage.overallPercentage),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(child: _StatChip(
                      label: 'Subjects',
                      value: '${subjects.length}',
                    )),
                    const SizedBox(width: 12),
                    Expanded(child: _StatChip(
                      label: 'Attended',
                      value: '${subjects.fold<int>(0, (a, s) => a + s.attended)}',
                    )),
                    const SizedBox(width: 12),
                    Expanded(child: _StatChip(
                      label: 'Total',
                      value: '${subjects.fold<int>(0, (a, s) => a + s.total)}',
                    )),
                  ],
                ),
                const SizedBox(height: 20),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Text('Your subjects',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 8),
                if (subjects.isEmpty)
                  GlassCard(
                    child: Column(
                      children: [
                        const Icon(Icons.school_outlined, size: 40),
                        const SizedBox(height: 8),
                        const Text('No subjects yet',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        Text('Tap + to add your first subject',
                            style: TextStyle(color: AuroraTheme.textLo)),
                      ],
                    ),
                  )
                else
                  ...subjects.map((s) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: SubjectTile(
                          subject: s,
                          onPresent: () => storage.markPresent(s.id),
                          onAbsent: () => storage.markAbsent(s.id),
                          onUndo: () => storage.undo(s.id),
                          onDelete: () => storage.remove(s.id),
                        ),
                      )),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const AddSubjectScreen()),
        ),
        backgroundColor: AuroraTheme.primary,
        icon: const Icon(Icons.add),
        label: const Text('Add subject'),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  const _StatChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
      child: Column(
        children: [
          Text(value,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(color: AuroraTheme.textLo, fontSize: 12)),
        ],
      ),
    );
  }
}

class _AuroraBackground extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: -100, left: -60,
            child: _blob(const Color(0xFF7C5CFF), 260),
          ),
          Positioned(
            top: 120, right: -80,
            child: _blob(const Color(0xFF22D3EE), 220),
          ),
          Positioned(
            bottom: -60, left: 40,
            child: _blob(const Color(0xFFEC4899), 200),
          ),
        ],
      ),
    );
  }

  Widget _blob(Color c, double s) => Container(
        width: s, height: s,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [c.withValues(alpha: 0.35), c.withValues(alpha: 0.0)],
          ),
        ),
      );
}
