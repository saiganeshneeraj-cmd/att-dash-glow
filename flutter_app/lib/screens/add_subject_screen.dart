import 'package:flutter/material.dart';
import '../models/subject.dart';
import '../services/storage_service.dart';
import '../theme/aurora_theme.dart';
import '../widgets/glass_card.dart';

class AddSubjectScreen extends StatefulWidget {
  const AddSubjectScreen({super.key});

  @override
  State<AddSubjectScreen> createState() => _AddSubjectScreenState();
}

class _AddSubjectScreenState extends State<AddSubjectScreen> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _attended = TextEditingController(text: '0');
  final _total = TextEditingController(text: '0');
  int target = 75;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add subject')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            GlassCard(
              child: Column(
                children: [
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Subject name'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _code,
                    decoration: const InputDecoration(labelText: 'Code (optional)'),
                  ),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: TextField(
                        controller: _attended,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Attended'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _total,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Total held'),
                      ),
                    ),
                  ]),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Target %', style: TextStyle(fontWeight: FontWeight.w600)),
                      Text('$target%',
                          style: TextStyle(
                              color: AuroraTheme.accent, fontWeight: FontWeight.w800)),
                    ],
                  ),
                  Slider(
                    value: target.toDouble(),
                    min: 50, max: 95, divisions: 9,
                    label: '$target%',
                    onChanged: (v) => setState(() => target = v.round()),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () async {
                if (_name.text.trim().isEmpty) return;
                await StorageService.instance.add(Subject(
                  name: _name.text.trim(),
                  code: _code.text.trim().isEmpty ? null : _code.text.trim(),
                  target: target,
                  attended: int.tryParse(_attended.text) ?? 0,
                  total: int.tryParse(_total.text) ?? 0,
                ));
                if (mounted) Navigator.pop(context);
              },
              child: const Text('Save subject'),
            ),
          ],
        ),
      ),
    );
  }
}
