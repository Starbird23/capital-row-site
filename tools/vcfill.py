"""Shared test helper: walk the valuation calculator through its two steps."""
async def fill_vc(pg, kind, rev, earn, sms=False):
    await pg.fill('#vcrev', rev); await pg.fill('#vcearn', earn)
    for sid, val in (('vcgrow', '5% to 15%'), ('vckind', kind), ('vcrec', '50% to 75%'), ('vctop', '10% to 25%'), ('vcreg', 'No'), ('vcinv', 'Leave at closing')):
        await pg.select_option('#' + sid, val)
    await pg.click('#vcf1 button[type=submit]'); await pg.wait_for_timeout(200)
    await pg.fill('#vcco', 'Mock Co'); await pg.select_option('#vcrole', label='Owner or founder')
    await pg.fill('#vcfn', 'Mock'); await pg.fill('#vcln', 'Person'); await pg.fill('#vcem', 'mock@example.com')
    await pg.select_option('#vcwhen', label='12 to 24 months')
    await pg.click('#vcf2 button[type=submit]'); await pg.wait_for_timeout(900)
