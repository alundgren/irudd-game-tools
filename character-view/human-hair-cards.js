import * as T from "three";

export function smoothHairCards(positions, triangles, uvCorners, packedUV) {
  const count = positions.length / 3;
  const edges = new Map(), adjacent = Array.from({length:count}, () => new Set());
  const rim = Array.from({length:count}, () => []);
  const edgeKey = (a,b) => Math.min(a,b)*count + Math.max(a,b);
  for (let i=0; i<triangles.length; i+=3) for (let j=0; j<3; j++) {
    const a=triangles[i+j], b=triangles[i+(j+1)%3], c=triangles[i+(j+2)%3];
    const key=edgeKey(a,b);
    if (!edges.has(key)) edges.set(key,{a,b,opposite:[], id:count+edges.size});
    edges.get(key).opposite.push(c);
    adjacent[a].add(b);
    adjacent[b].add(a);
  }
  const refined = new Float32Array(3*(count+edges.size));
  for (const {a,b,opposite,id} of edges.values()) {
    if (opposite.length === 1) { rim[a].push(b); rim[b].push(a); }
    for (let d=0; d<3; d++) {
      const ends = positions[3*a+d]+positions[3*b+d];
      refined[3*id+d] = opposite.length === 2
        ? .375*ends+.125*(positions[3*opposite[0]+d]+positions[3*opposite[1]+d])
        : .5*ends;
    }
  }
  for (let a=0; a<count; a++) {
    const boundary = rim[a];
    const neighbours = boundary.length ? boundary : adjacent[a];
    const n = boundary.length || adjacent[a].size;
    const beta = boundary.length === 2 ? .125 : boundary.length || !n ? 0 : n===3 ? .1875 : .375/n;
    for (let d=0; d<3; d++) {
      let value = positions[3*a+d]*(1-beta*n);
      for (const b of neighbours) value += beta*positions[3*b+d];
      refined[3*a+d] = value;
    }
  }

  const uv = Array.from(packedUV,v => v/65535), uvCount = uv.length/2;
  const halves = new Map();
  const uvMid = (a,b) => {
    const key=Math.min(a,b)*uvCount+Math.max(a,b);
    if (!halves.has(key)) {
      halves.set(key,uv.length/2);
      uv.push(.5*(uv[2*a]+uv[2*b]),.5*(uv[2*a+1]+uv[2*b+1]));
    }
    return halves.get(key);
  };
  const faces=[], texture=[];
  function split(out,a,b,c,ab,bc,ca) {
    out.push(a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca);
  }
  for (let i=0; i<triangles.length; i+=3) {
    const [a,b,c] = triangles.subarray(i,i+3), [u,v,w] = uvCorners.subarray(i,i+3);
    split(faces,a,b,c,edges.get(edgeKey(a,b)).id,edges.get(edgeKey(b,c)).id,edges.get(edgeKey(c,a)).id);
    split(texture,u,v,w,uvMid(u,v),uvMid(v,w),uvMid(w,u));
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position",new T.BufferAttribute(refined,3));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  const normal = geo.attributes.normal.array;
  const pos=[], normals=[], tex=[], indices=[], seen=new Map();
  for (let i=0; i<faces.length; i++) {
    const v=faces[i], t=texture[i], key=v*(uv.length/2)+t;
    if (!seen.has(key)) {
      seen.set(key,pos.length/3);
      pos.push(...refined.subarray(3*v,3*v+3));
      normals.push(...normal.subarray(3*v,3*v+3));
      tex.push(uv[2*t],uv[2*t+1]);
    }
    indices.push(seen.get(key));
  }
  geo.setIndex(indices);
  geo.setAttribute("position",new T.Float32BufferAttribute(pos,3));
  geo.setAttribute("normal",new T.Float32BufferAttribute(normals,3));
  geo.setAttribute("uv",new T.Float32BufferAttribute(tex,2));
  return geo;
}
