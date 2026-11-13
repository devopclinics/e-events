"""Captured certificate signatures determine how many signature blocks render."""
import unittest
from types import SimpleNamespace
from app.certificate_originals import original_certificate

class SignatureLayoutTests(unittest.TestCase):
    def render(self, layout, people, preview=False):
        cert = SimpleNamespace(snapshot={'participant_name': 'Bimpe Akinfolajimi', 'event_name': 'PAMCON', 'design': {'layout': layout, 'layout_version': 2}, 'signatories': people}, certificate_number='EXISTING-42')
        return original_certificate(cert, preview=preview, qr='test-qr')

    def test_one_captured_signer_has_no_second_placeholder(self):
        for layout in ['royal', 'heritage', 'midnight', 'ivory']:
            with self.subTest(layout=layout):
                html = self.render(layout, [{'name': 'Approved Person', 'title': 'Chairman', 'signature_png': 'data:image/png;base64,signature'}])
                self.assertEqual(html.count('class="sig"'), 1)
                self.assertIn('signatures single-signatory', html)
                self.assertIn('Approved Person', html)
                self.assertIn('alt="Approved signature"', html)
                self.assertIn('alt="Scan to verify"', html)
                self.assertIn('EXISTING-42', html)
                self.assertNotIn('Authorised Signatory', html)
                self.assertNotIn('Name and title', html)

    def test_two_signers_keep_both_blocks(self):
        for layout in ['royal', 'heritage', 'midnight', 'ivory']:
            html = self.render(layout, [{'name': 'First'}, {'name': 'Second'}])
            self.assertEqual(html.count('class="sig"'), 2)
            self.assertNotIn('single-signatory', html)

    def test_unsigned_design_samples_keep_placeholders_and_no_signature(self):
        html = self.render('royal', [], preview=True)
        self.assertEqual(html.count('class="sig"'), 2)
        self.assertNotIn('Approved signature', html)
        self.assertIn('DESIGN PREVIEW', html)

    def test_dynamic_signer_content_stays_escaped(self):
        html = self.render('royal', [{'name': '<script>name</script>', 'title': '<b>title</b>'}])
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)

if __name__ == '__main__':
    unittest.main()
