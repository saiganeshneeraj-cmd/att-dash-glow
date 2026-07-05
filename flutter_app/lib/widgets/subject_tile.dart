import 'package:flutter/material.dart';
import '../models/subject.dart';
import '../theme/aurora_theme.dart';
import 'glass_card.dart';

class SubjectTile extends StatelessWidget {
  final Subject subject;
  final VoidCallback onPresent;
  final VoidCallback onAbsent;
  final VoidCallback onUndo;
  final VoidCallback onDelete;

  const SubjectTile({
    super.key,
    required this.subject,
    required this.onPresent,
    required this.onAbsent,
    required this.onUndo,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final pct = subject.percentage;
    final color = pct >= subject.target
        ? AuroraTheme.success
        : pct >= subject.target - 5
            ? AuroraTheme.warning
            : AuroraTheme.danger;
    final hint = pct >= subject.target
        ? 'Can skip ${subject.canSkip()} class(es)'
        : 'Must attend ${subject.mustAttend()} in a row';

    return GlassCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(subject.name,
                        style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text('${subject.attended}/${subject.total}  •  target ${subject.target}%',
                        style: TextStyle(color: AuroraTheme.textLo, fontSize: 12)),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: color.withOpacity(0.4)),
                ),
                child: Text('${pct.toStringAsFixed(1)}%',
                    style: TextStyle(color: color, fontWeight: FontWeight.w700)),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20),
                color: AuroraTheme.textLo,
                onPressed: onDelete,
              ),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: (pct / 100).clamp(0, 1),
              minHeight: 6,
              backgroundColor: Colors.white.withOpacity(0.06),
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
          const SizedBox(height: 10),
          Text(hint, style: TextStyle(color: AuroraTheme.textLo, fontSize: 12)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.tonalIcon(
                  onPressed: onPresent,
                  icon: const Icon(Icons.check, size: 18),
                  label: const Text('Present'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AuroraTheme.success.withOpacity(0.18),
                    foregroundColor: AuroraTheme.success,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.tonalIcon(
                  onPressed: onAbsent,
                  icon: const Icon(Icons.close, size: 18),
                  label: const Text('Absent'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AuroraTheme.danger.withOpacity(0.15),
                    foregroundColor: AuroraTheme.danger,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: onUndo,
                icon: const Icon(Icons.undo),
                tooltip: 'Undo last',
              ),
            ],
          ),
        ],
      ),
    );
  }
}
