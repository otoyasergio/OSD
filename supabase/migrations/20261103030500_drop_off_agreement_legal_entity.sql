-- The v1 seed named the trade name as the contracting party. Correct that
-- row only while it still holds the original seed text. A published legal
-- template has different HTML and is left as stored.

update public.drop_off_agreement_template
set body_html = $fixed$<h2>OTOMOTO TORONTO MOTO INC. — Drop-Off Agreement</h2>
<p>By signing below, the customer acknowledges and agrees to the following terms for motorcycle service at OTOMOTO TORONTO MOTO INC.</p>
<section data-initial="liability"><h3>1. Liability &amp; Storage</h3>
<p>The shop is not responsible for loss or damage due to theft, fire, or events beyond reasonable control while the motorcycle is on premises. Storage fees may apply after 30 days following notification of completion.</p></section>
<section data-initial="authorization"><h3>2. Service Authorization</h3>
<p>Customer authorizes diagnostic inspection and the repair work described on this work order. Additional work requires separate approval.</p></section>
<section data-initial="parts"><h3>3. Parts &amp; Labour</h3>
<p>Quoted prices are estimates. Final invoice reflects actual parts and labour. Deposits are non-refundable once special-order parts are ordered.</p></section>
<section data-initial="condition"><h3>4. Vehicle Condition</h3>
<p>Customer confirms the motorcycle condition documented in intake photos accurately reflects its state at drop-off, including mileage and visible damage.</p></section>
<section data-initial="pickup"><h3>5. Pickup</h3>
<p>Customer agrees to pick up the motorcycle within 14 days of ready-for-pickup notification. Uncollected motorcycles may incur storage charges.</p></section>
<p><strong>Customer signature below confirms agreement to all sections.</strong></p>$fixed$
where body_html = $seed$<h2>Toronto Moto — Drop-Off Agreement</h2>
<p>By signing below, the customer acknowledges and agrees to the following terms for motorcycle service at Toronto Moto.</p>
<section data-initial="liability"><h3>1. Liability &amp; Storage</h3>
<p>The shop is not responsible for loss or damage due to theft, fire, or events beyond reasonable control while the motorcycle is on premises. Storage fees may apply after 30 days following notification of completion.</p></section>
<section data-initial="authorization"><h3>2. Service Authorization</h3>
<p>Customer authorizes diagnostic inspection and the repair work described on this work order. Additional work requires separate approval.</p></section>
<section data-initial="parts"><h3>3. Parts &amp; Labour</h3>
<p>Quoted prices are estimates. Final invoice reflects actual parts and labour. Deposits are non-refundable once special-order parts are ordered.</p></section>
<section data-initial="condition"><h3>4. Vehicle Condition</h3>
<p>Customer confirms the motorcycle condition documented in intake photos accurately reflects its state at drop-off, including mileage and visible damage.</p></section>
<section data-initial="pickup"><h3>5. Pickup</h3>
<p>Customer agrees to pick up the motorcycle within 14 days of ready-for-pickup notification. Uncollected motorcycles may incur storage charges.</p></section>
<p><strong>Customer signature below confirms agreement to all sections.</strong></p>$seed$;
